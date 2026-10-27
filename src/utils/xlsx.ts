import ExcelJS from 'exceljs'
import { onFileChange } from './JsonOperateUtils'

export interface Sheet {
  name: string
  rows: string[][]
}

/**
 * 解析 xlsx 为多个 sheet，每个 sheet 的 rows 为二维字符串数组（首行为表头）。
 * 空单元格渲染为空字符串；不处理合并单元格。
 */
export async function parseXlsx(buffer: ArrayBuffer): Promise<Sheet[]> {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(buffer)
  return workbook.worksheets.map((ws) => {
    const rows: string[][] = []
    ws.eachRow((row) => {
      const cells: string[] = []
      row.eachCell({ includeEmpty: true }, (cell) => {
        const v = cell.value
        if (v == null) {
          cells.push('')
        } else if (typeof v === 'object' && 'text' in (v as object)) {
          cells.push(String((v as { text: unknown }).text))
        } else if (typeof v === 'object' && 'result' in (v as object)) {
          cells.push(String((v as { result: unknown }).result))
        } else if (typeof v === 'object' && 'richText' in (v as object)) {
          cells.push(String((v as { richText: Array<{ text: string }> }).richText.map((r) => r.text).join('')))
        } else {
          cells.push(String(v))
        }
      })
      rows.push(cells)
    })
    return { name: ws.name, rows }
  })
}

/**
 * 读取并监听一个 xlsx 文件，变化时解析出全部 sheet 并回调。
 * relPath 为相对于数据根目录的路径。返回取消订阅函数。
 */
export function watchXlsx(
  relPath: string,
  callback: (sheets: Sheet[]) => void,
  options: { pollMs?: number; immediate?: boolean } = {},
): () => void {
  return onFileChange(
    relPath,
    async (buf) => {
      const sheets = await parseXlsx(buf)
      callback(sheets)
    },
    options,
  )
}
