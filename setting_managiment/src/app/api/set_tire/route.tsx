// パスパラメーターを受け取ってsupabaseのt_tireテーブルにデータを追加するAPIを作成しました。
// wheel_id : タイヤのID
// 読取時の時間

import { NextResponse } from "next/server";

export const GET = () => {
  // JSTの現在時刻を取得
  const now = new Date().toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
  return NextResponse.json({ message: "GET", now });
};
