import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Fuel, Timer, Users, TrendingUp } from "lucide-react";

export default function Dashboard() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">ダッシュボード</h1>
        <p className="text-muted-foreground">
          レースの現在状況と戦略情報を確認できます
        </p>
      </div>

      {/* 概要カード */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              現在の燃料残量
            </CardTitle>
            <Fuel className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">15.2L</div>
            <p className="text-xs text-muted-foreground">
              タンク容量の 76%
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              現在周回数
            </CardTitle>
            <Timer className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">42周</div>
            <p className="text-xs text-muted-foreground">
              総 200周 中
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              現在ライダー
            </CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">田中 太郎</div>
            <p className="text-xs text-muted-foreground">
              平均ラップ: 1:45.234
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              次回ピット予定
            </CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">58周</div>
            <p className="text-xs text-muted-foreground">
              約 28分後
            </p>
          </CardContent>
        </Card>
      </div>

      {/* メインコンテンツエリア */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
        <Card className="col-span-4">
          <CardHeader>
            <CardTitle>ラップタイム推移</CardTitle>
            <CardDescription>
              計画 vs 実績のラップタイム比較
            </CardDescription>
          </CardHeader>
          <CardContent className="pl-2">
            <div className="h-[300px] flex items-center justify-center text-muted-foreground">
              ラップタイムチャート（実装予定）
            </div>
          </CardContent>
        </Card>

        <Card className="col-span-3">
          <CardHeader>
            <CardTitle>燃料予測</CardTitle>
            <CardDescription>
              現在の消費ペースに基づく予測
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">残り可能周回数</span>
                <span className="text-lg font-bold">38周</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">燃費</span>
                <span className="text-lg font-bold">0.4L/周</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">次回給油量</span>
                <span className="text-lg font-bold">12.8L</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ピット戦略 */}
      <Card>
        <CardHeader>
          <CardTitle>ピット戦略</CardTitle>
          <CardDescription>
            今後のピットイン予定とライダー交代
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="grid grid-cols-4 gap-4 text-sm font-medium text-muted-foreground">
              <div>周回</div>
              <div>ライダー</div>
              <div>作業内容</div>
              <div>予定時刻</div>
            </div>
            <div className="space-y-2">
              <div className="grid grid-cols-4 gap-4 text-sm">
                <div>58周</div>
                <div>田中 太郎 → 佐藤 花子</div>
                <div>給油 + ライダー交代</div>
                <div>14:25</div>
              </div>
              <div className="grid grid-cols-4 gap-4 text-sm">
                <div>95周</div>
                <div>佐藤 花子 → 鈴木 次郎</div>
                <div>給油 + ライダー交代</div>
                <div>15:45</div>
              </div>
              <div className="grid grid-cols-4 gap-4 text-sm">
                <div>140周</div>
                <div>鈴木 次郎 → 田中 太郎</div>
                <div>給油 + ライダー交代</div>
                <div>17:10</div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
