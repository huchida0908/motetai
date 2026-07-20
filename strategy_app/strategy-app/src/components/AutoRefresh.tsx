'use client';

// サーバーコンポーネント（page.tsx）を定期的に再取得するための小さなヘルパー。
// page.tsx は force-dynamic のサーバーコンポーネントで、そのままだと開いた瞬間の値で固定される。
// router.refresh() を一定間隔で呼ぶと、クライアントの状態（チャート等）を保ったまま
// サーバー側の getLiveState を再実行して最新の実績・ペース・ピット予測に更新できる。
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function AutoRefresh({ intervalMs = 10000 }: { intervalMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const id = setInterval(() => router.refresh(), intervalMs);
    return () => clearInterval(id);
  }, [router, intervalMs]);
  return null;
}
