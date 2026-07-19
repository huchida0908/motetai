'use client';

import { ImportPanel } from '@/components/ImportPanel';

// 「取込」ページ（フル表示）。中身は ImportPanel を共有し、
// ライブ入力ページ(/live)にも同じパネルを埋め込んでいる。
export default function ScrapePage() {
  return <ImportPanel />;
}
