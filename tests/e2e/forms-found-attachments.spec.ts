import { expect, test } from '@playwright/test';

test('found official attachments are under review without becoming approved downloads @mobile', async ({ page }) => {
  await page.goto('/p/g11110.bokjiro-WLF00002778');
  const panel = page.getByTestId('application-forms');
  await expect(panel.getByText('연결 검토 중', { exact: true })).toBeVisible();
  await expect(panel.getByText('신청서 찾는 중', { exact: true })).toHaveCount(0);
  await expect(panel.locator('a[download]')).toHaveCount(0);
  await expect(panel.getByTestId('forms-source-attachments')).toBeVisible();
  await expect(panel).toContainText('이 사업에 사용할 신청서인지 확인이 필요해요.');
});
