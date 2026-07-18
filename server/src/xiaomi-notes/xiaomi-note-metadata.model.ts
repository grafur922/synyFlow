export type NotePrivacyLevel = 'public' | 'private' | 'secret'

export interface XiaomiNoteMetadata {
  noteId: string
  favorite: boolean
  archived: boolean
  tags: string[]
  privacy: NotePrivacyLevel
  createdAt: number
  updatedAt: number
}

export interface UpdateXiaomiNoteMetadataInput {
  favorite?: boolean
  archived?: boolean
  tags?: string[]
  privacy?: NotePrivacyLevel
}
