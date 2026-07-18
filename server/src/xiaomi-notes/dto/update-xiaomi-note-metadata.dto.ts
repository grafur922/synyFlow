import type { NotePrivacyLevel, UpdateXiaomiNoteMetadataInput } from '../xiaomi-note-metadata.model'

export class UpdateXiaomiNoteMetadataDto implements UpdateXiaomiNoteMetadataInput {
  favorite?: boolean
  archived?: boolean
  tags?: string[]
  privacy?: NotePrivacyLevel
}
