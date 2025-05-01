import { prisma } from '../lib/prisma'

async function main() {
  try {
    // データベース接続テスト
    const result = await prisma.$queryRaw`SELECT 1+1 AS result`
    console.log('🚀 データベース接続成功:', result)
    
    // テーブル一覧を取得（オプション）
    const tables = await prisma.$queryRaw`SHOW TABLES`
    console.log('📋 テーブル一覧:', tables)
  } catch (error) {
    console.error('❌ データベース接続エラー:', error)
  } finally {
    // 接続を閉じる
    await prisma.$disconnect()
  }
}

main() 