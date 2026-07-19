// 共有ページ（トークン付きリンク）。
// SHARE_TOKEN 環境変数と URL のトークンが一致した場合のみ閲覧専用ダッシュボードを表示する。
// 未設定 or 不一致は 404（安全側デフォルト）。トークン検証はサーバー側で完結し、クライアントに漏れない。
// ※ /api/live 等の GET API 自体は公開のままなので、これは「URLを知らない人が入りにくくする」程度の保護。
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import ShareDashboard from '@/components/ShareDashboard';

// トークンは実行時に照合するため常に動的レンダリング
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: '共有ダッシュボード',
  robots: { index: false, follow: false }, // 検索エンジンにインデックスさせない
};

export default async function SharePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const expected = process.env.SHARE_TOKEN;
  if (!expected || token !== expected) {
    notFound();
  }

  return <ShareDashboard carno={process.env.SHARE_CARNO ?? null} />;
}
