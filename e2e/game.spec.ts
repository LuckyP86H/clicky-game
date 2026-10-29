import { expect, type Page, test } from '@playwright/test';

async function boardIds(page: Page): Promise<string[]> {
	return page
		.locator('[data-testid="card"]')
		.evaluateAll((els) => els.map((el) => el.getAttribute('data-card-id') ?? ''));
}

async function clickCard(page: Page, id: string) {
	await page.locator(`[data-card-id="${id}"]`).click();
}

/** Click the first card, then click the SAME card again: a guaranteed bust. */
async function bustRun(page: Page) {
	const [first] = await boardIds(page);
	await clickCard(page, first as string);
	await expect(page.getByTestId('score')).toHaveText('1');
	await clickCard(page, first as string);
	await expect(page.getByTestId('run-end')).toContainText('Bust');
}

test.beforeEach(async ({ page }) => {
	await page.goto('/');
	await expect(page.getByTestId('card')).toHaveCount(12);
});

test('loads the classic board with 12 cards and a zero score', async ({ page }) => {
	await expect(page.getByTestId('score')).toHaveText('0');
	await expect(page.getByRole('heading', { name: /Clickster/ })).toBeVisible();
});

test('clicking a fresh card scores a point', async ({ page }) => {
	const [first] = await boardIds(page);
	await clickCard(page, first as string);
	await expect(page.getByTestId('score')).toHaveText('1');
});

test('clicking the same card twice busts the run, and Play again restarts', async ({ page }) => {
	await bustRun(page);
	await page.getByTestId('play-again').click();
	await expect(page.getByTestId('score')).toHaveText('0');
	await expect(page.getByTestId('run-end')).toHaveCount(0);
});

test('clicking every card exactly once wins the run', async ({ page }) => {
	const ids = await boardIds(page);
	for (const id of ids) await clickCard(page, id);
	await expect(page.getByTestId('run-end')).toContainText('You win');
	await expect(page.getByTestId('score')).toHaveText('12');
});

test('keyboard: Enter on a focused card clicks it', async ({ page }) => {
	const first = page.getByTestId('card').first();
	await first.focus();
	await page.keyboard.press('Enter');
	await expect(page.getByTestId('score')).toHaveText('1');
});

test('timed mode shows a countdown and scores clicks', async ({ page }) => {
	await page.getByTestId('mode-timed').click();
	await expect(page.getByTestId('timer')).toContainText('s');
	const [first] = await boardIds(page);
	await clickCard(page, first as string);
	await expect(page.getByTestId('score')).toHaveText('1');
});

test('daily challenge deals the identical board on a reload', async ({ page }) => {
	await page.getByTestId('mode-daily').click();
	await expect(page.getByTestId('card')).toHaveCount(12);
	const firstVisit = await boardIds(page);
	await page.reload();
	await expect(page.getByTestId('card')).toHaveCount(12);
	await page.getByTestId('mode-daily').click();
	const secondVisit = await boardIds(page);
	expect(secondVisit).toEqual(firstVisit);
});

test('a finished run can be submitted to the leaderboard', async ({ page }) => {
	await bustRun(page);
	await page.getByTestId('lb-name').fill('E2E Tester');
	await page.getByTestId('lb-submit').click();
	await expect(page.getByTestId('lb-message')).toContainText('Submitted');
	await expect(page.getByTestId('lb-entries')).toContainText('E2E Tester');
});

test('a finished run appears in the memory-training stats', async ({ page }) => {
	await bustRun(page);
	await expect(page.getByTestId('stats-panel')).toBeVisible();
	await expect(page.getByTestId('stat-total')).toHaveText('1');
	await expect(page.getByTestId('achievements')).toContainText('First Steps');
});

test('the curator builds a playable deck for a theme', async ({ page }) => {
	test.setTimeout(120_000);
	await page.getByTestId('theme-input').fill('deep sea animals');
	await page.getByTestId('curate-button').click();
	await expect(page.getByTestId('curate-steps')).toBeVisible();
	await expect(page.getByTestId('deck-ready')).toBeVisible({ timeout: 90_000 });
	await page.getByTestId('play-deck').click();
	await expect(page.getByTestId('card')).toHaveCount(12);
	const [first] = await boardIds(page);
	await clickCard(page, first as string);
	await expect(page.getByTestId('score')).toHaveText('1');
});
