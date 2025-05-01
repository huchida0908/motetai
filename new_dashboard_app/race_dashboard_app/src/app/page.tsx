'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import dynamic from 'next/dynamic';

// Chart.jsコンポーネントをクライアントサイドでのみロードするために動的にインポート
const LapTimeChart = dynamic(() => import('@/components/LapTimeChart'), {
  ssr: false,
  loading: () => (
    <div className="flex justify-center items-center h-96 bg-white p-6 rounded-lg shadow-md mb-6">
      <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500"></div>
    </div>
  ),
});

interface RankingData {
  lap: string;
  name: string;
  sec1: string | null;
  sec2: string | null;
  sec3: string | null;
  speed: string | null;
  sec4: string | null;
  record: string | null;
  pit: string | null;
  rank: string | null;
}

interface BestLapData {
  name: string;
  lap: string;
  record: string;
  speed: string | null;
}

export default function Home() {
  const [rankings, setRankings] = useState<RankingData[]>([]);
  const [bestLaps, setBestLaps] = useState<BestLapData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchData() {
      try {
        // 現在の順位データを取得
        const rankingsResponse = await fetch('/api/current-rankings');
        if (!rankingsResponse.ok) {
          throw new Error('ランキングデータの取得に失敗しました');
        }
        const rankingsData = await rankingsResponse.json();
        setRankings(rankingsData.rankings);

        // ベストラップデータを取得
        const bestLapsResponse = await fetch('/api/best-lap-times');
        if (!bestLapsResponse.ok) {
          throw new Error('ベストラップデータの取得に失敗しました');
        }
        const bestLapsData = await bestLapsResponse.json();
        setBestLaps(bestLapsData.bestLapTimes);
      } catch (err) {
        setError(err instanceof Error ? err.message : '不明なエラーが発生しました');
        console.error('データ取得エラー:', err);
      } finally {
        setLoading(false);
      }
    }

    fetchData();

    // 定期的に更新
    const intervalId = setInterval(fetchData, 10000); // 10秒ごとに更新

    return () => clearInterval(intervalId); // クリーンアップ
  }, []);

  // 上位3チームのデータを抽出
  const topThreeTeams = rankings.slice(0, 3);
  // 上位3チームのベストラップデータを抽出
  const topThreeBestLaps = bestLaps.slice(0, 3);

  return (
    <div className="min-h-screen p-4 bg-gray-100">
      <header className="bg-blue-700 text-white p-4 mb-6 rounded-lg shadow-md">
        <h1 className="text-2xl font-bold text-center">レースダッシュボード</h1>
      </header>

      <main>
        {loading ? (
          <div className="flex justify-center p-8">
            <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500"></div>
          </div>
        ) : error ? (
          <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-6">
            <p>{error}</p>
          </div>
        ) : (
          <>
            {/* カードセクション */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
              {/* 現在の順位カード */}
              <div>
                <h2 className="text-xl font-semibold mb-3 text-gray-700">現在の順位</h2>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {topThreeTeams.map((team, index) => (
                    <div 
                      key={`card-${team.name}`} 
                      className={`p-6 rounded-lg shadow-lg text-center ${
                        index === 0 
                          ? 'bg-yellow-100 border-2 border-yellow-400' 
                          : index === 1 
                            ? 'bg-gray-100 border-2 border-gray-400' 
                            : 'bg-amber-100 border-2 border-amber-600'
                      }`}
                    >
                      <div className="text-5xl font-bold mb-2">
                        {team.rank}
                        <span className="text-sm ml-1 align-top">位</span>
                      </div>
                      <div className="text-lg text-gray-700 mb-3 font-semibold truncate">
                        {team.name}
                      </div>
                      <div className="text-2xl font-mono">
                        {team.record}
                      </div>
                      <div className="mt-2 text-gray-500 text-sm">
                        ラップ {team.lap}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* ベストラップカード */}
              <div>
                <h2 className="text-xl font-semibold mb-3 text-gray-700">ベストラップ</h2>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {topThreeBestLaps.map((team, index) => (
                    <div 
                      key={`best-${team.name}`} 
                      className="p-6 rounded-lg shadow-lg text-center bg-blue-50 border-2 border-blue-400"
                    >
                      <div className="text-5xl font-bold mb-2 text-blue-600">
                        {index + 1}
                        <span className="text-sm ml-1 align-top">位</span>
                      </div>
                      <div className="text-lg text-gray-700 mb-3 font-semibold truncate">
                        {team.name}
                      </div>
                      <div className="text-2xl font-mono text-blue-700">
                        {team.record}
                      </div>
                      <div className="mt-2 text-gray-500 text-sm flex justify-center items-center gap-2">
                        <span>ラップ {team.lap}</span>
                        {team.speed && (
                          <span className="bg-blue-100 text-blue-800 text-xs px-2 py-1 rounded-full">
                            {team.speed} km/h
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* ラップタイムチャート */}
            <LapTimeChart />

            {/* 既存のテーブル */}
            <section className="bg-white p-6 rounded-lg shadow-md mb-6">
              <h2 className="text-xl font-semibold mb-4 border-b pb-2">現在の順位</h2>
              
              {rankings.length === 0 ? (
                <p className="text-center py-4 text-gray-500">表示するデータがありません</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">順位</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">チーム</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">ラップ</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">ラップタイム</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">速度</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {rankings.map((entry, index) => (
                        <tr key={`${entry.name}-${entry.lap}`} className={index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                          <td className="px-4 py-3 whitespace-nowrap">
                            <div className="text-sm font-medium text-gray-900">{entry.rank}</div>
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            <div className="text-sm text-gray-900">{entry.name}</div>
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            <div className="text-sm text-gray-900">{entry.lap}</div>
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            <div className="text-sm text-gray-900">{entry.record}</div>
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            <div className="text-sm text-gray-900">{entry.speed ? `${entry.speed} km/h` : '-'}</div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  );
}
