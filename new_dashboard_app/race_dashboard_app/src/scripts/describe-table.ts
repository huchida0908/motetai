import { prisma } from '../lib/prisma'

async function main() {
  try {
    const tableStructure = await prisma.$queryRaw`DESCRIBE laps`
    console.log(JSON.stringify(tableStructure, null, 2))
  } catch (error) {
    console.error('エラー:', error)
  } finally {
    await prisma.$disconnect()
  }
}

main() 