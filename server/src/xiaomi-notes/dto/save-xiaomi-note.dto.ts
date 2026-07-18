import type { XiaomiNoteInput } from '../xiaomi-note.model'

export class SaveXiaomiNoteDto implements XiaomiNoteInput {
  title!: string
  content!: string
}
