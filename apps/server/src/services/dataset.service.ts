import { readFile } from 'fs/promises'
import path from 'path'
import type { ClinicalExtraction } from '../../../../packages/shared/src/index'

const dataRoot = path.resolve('..', '..', 'data')

export async function loadTranscript(transcriptId: string) {
  const file = path.join(dataRoot, 'transcripts', `${transcriptId}.txt`)
  return readFile(file, 'utf-8')
}

export async function loadGold(transcriptId: string): Promise<ClinicalExtraction> {
  const file = path.join(dataRoot, 'gold', `${transcriptId}.json`)
  const text = await readFile(file, 'utf-8')
  return JSON.parse(text) as ClinicalExtraction
}

export async function listTranscriptIds() {
  const dir = path.join(dataRoot, 'transcripts')
  const entries = await import('fs/promises').then((fs) => fs.readdir(dir))
  return entries.filter((name) => name.endsWith('.txt')).map((name) => name.replace(/\.txt$/, ''))
}
