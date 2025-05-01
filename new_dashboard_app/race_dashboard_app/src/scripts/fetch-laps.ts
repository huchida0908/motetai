import { prisma } from '../lib/prisma'

async function main() {
  try {
    // 最大10件のラップデータを取得
    const laps = await prisma.lap.findMany({
      take: 10
    })
    
    console.log('取得したラップデータ:')
    console.log(JSON.stringify(laps, null, 2))
    
    // ラップ数をカウント
    const count = await prisma.lap.count()
    console.log(`\n合計レコード数: ${count}`)
    
  } catch (error) {
    console.error('エラー:', error)
  } finally {
    await prisma.$disconnect()
  }
}

main() 