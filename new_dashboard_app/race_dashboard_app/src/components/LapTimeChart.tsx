'use client';

import { useEffect, useState } from 'react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  ChartOptions,
} from 'chart.js';
import { Line } from 'react-chartjs-2';

// Chart.jsのコンポーネントを登録
ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend
);

interface TeamLapData {
  [teamName: string]: {
    lap: string;
    time: number;
  }[];
}

// 最大チーム表示数
const MAX_TEAMS_TO_DISPLAY = 5;

// チャート色
const CHART_COLORS = [
  'rgba(255, 99, 132, 0.8)',   // 赤
  'rgba(54, 162, 235, 0.8)',   // 青
  'rgba(255, 206, 86, 0.8)',   // 黄
  'rgba(75, 192, 192, 0.8)',   // 緑
  'rgba(153, 102, 255, 0.8)',  // 紫
  'rgba(255, 159, 64, 0.8)',   // オレンジ
  'rgba(199, 199, 199, 0.8)',  // グレー
  'rgba(83, 102, 255, 0.8)',   // 藍
  'rgba(255, 99, 255, 0.8)',   // ピンク
  'rgba(159, 159, 64, 0.8)',   // オリーブ
];

// 秒数をMM:SS.ms形式に変換する関数
function formatTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = (seconds % 60).toFixed(3);
  return `${minutes}:${remainingSeconds.padStart(6, '0')}`;
}

export default function LapTimeChart() {
  const [teamData, setTeamData] = useState<TeamLapData>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [displayedTeams, setDisplayedTeams] = useState<string[]>([]);
  const [allTeams, setAllTeams] = useState<string[]>([]);

  useEffect(() => {
    async function fetchLapTimes() {
      try {
        const response = await fetch('/api/lap-times');
        if (!response.ok) {
          throw new Error('ラップタイムデータの取得に失敗しました');
        }

        const data = await response.json();
        setTeamData(data.teamData);

        // 全チーム名の配列を設定
        const teams = Object.keys(data.teamData);
        setAllTeams(teams);
        
        // デフォルトで表示するチーム（上位5チーム）
        setDisplayedTeams(teams.slice(0, MAX_TEAMS_TO_DISPLAY));
      } catch (err) {
        setError(err instanceof Error ? err.message : '不明なエラーが発生しました');
        console.error('ラップタイムデータの取得エラー:', err);
      } finally {
        setLoading(false);
      }
    }

    fetchLapTimes();

    // 30秒ごとに更新
    const intervalId = setInterval(fetchLapTimes, 30000);
    return () => clearInterval(intervalId);
  }, []);

  // チームの選択状態を切り替える
  const toggleTeam = (teamName: string) => {
    setDisplayedTeams(prev => {
      if (prev.includes(teamName)) {
        return prev.filter(t => t !== teamName);
      } else {
        return [...prev, teamName];
      }
    });
  };

  // チャートデータの作成
  const chartData = {
    // すべてのラップ番号を集めて重複を排除し、数値順にソート
    labels: [...new Set(
      Object.values(teamData)
        .flatMap(teamLaps => teamLaps.map(lap => lap.lap))
    )].sort((a, b) => parseInt(a) - parseInt(b)),
    datasets: displayedTeams.map((team, index) => ({
      label: team,
      data: teamData[team]?.map(lap => lap.time) || [],
      borderColor: CHART_COLORS[index % CHART_COLORS.length],
      backgroundColor: CHART_COLORS[index % CHART_COLORS.length].replace('0.8', '0.1'),
      borderWidth: 2,
      pointRadius: 3,
      pointHoverRadius: 5,
      tension: 0.1,
      // x軸の値を設定
      lap: teamData[team]?.map(lap => lap.lap) || [],
    })),
  };

  const options: ChartOptions<'line'> = {
    responsive: true,
    maintainAspectRatio: false,
    scales: {
      y: {
        title: {
          display: true,
          text: 'ラップタイム（秒）',
        },
        ticks: {
          callback: function(value) {
            return formatTime(value as number);
          }
        }
      },
      x: {
        title: {
          display: true,
          text: 'ラップ数',
        }
      }
    },
    plugins: {
      tooltip: {
        callbacks: {
          label: function(context) {
            const datasetLabel = context.dataset.label || '';
            const value = context.parsed.y;
            return `${datasetLabel}: ${formatTime(value)}`;
          }
        }
      },
      legend: {
        position: 'top',
        labels: {
          boxWidth: 15,
          padding: 15,
        }
      },
      title: {
        display: true,
        text: 'チーム別ラップタイム推移',
        font: {
          size: 16,
        },
        padding: {
          top: 10,
          bottom: 20
        }
      }
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center h-96">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-6">
        <p>{error}</p>
      </div>
    );
  }

  return (
    <section className="bg-white p-6 rounded-lg shadow-md mb-6">
      <h2 className="text-xl font-semibold mb-4 border-b pb-2">ラップタイム推移</h2>

      {/* チーム選択ボタン */}
      <div className="mb-4 flex flex-wrap gap-2">
        {allTeams.map((team, index) => (
          <button
            key={team}
            className={`px-3 py-1 text-sm rounded-full transition-all ${
              displayedTeams.includes(team)
                ? `bg-opacity-90 text-white shadow-sm` 
                : 'bg-gray-200 text-gray-500'
            }`}
            style={{
              backgroundColor: displayedTeams.includes(team) 
                ? CHART_COLORS[index % CHART_COLORS.length] 
                : '',
            }}
            onClick={() => toggleTeam(team)}
          >
            {team.length > 20 ? team.substring(0, 20) + '...' : team}
          </button>
        ))}
      </div>

      {/* グラフ */}
      <div className="h-96">
        <Line data={chartData} options={options} />
      </div>
    </section>
  );
} 