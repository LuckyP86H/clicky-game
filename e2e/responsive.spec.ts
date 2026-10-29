import { expect, test } from '@playwright/test';

test('mobile: the board renders fully without horizontal scrolling', async ({ page }) => {
	await page.goto('/');
	await expect(page.getByTestId('card')).toHaveCount(12);
	const overflow = await page.evaluate(
		() => document.documentElement.scrollWidth - document.documentElement.clientWidth
	);
	expect(overflow).toBeLessThanOrEqual(0);
	// Cards remain tappable at phone size.
	await page.getByTestId('card').first().tap();
	await expect(page.getByTestId('score')).toHaveText('1');
});
