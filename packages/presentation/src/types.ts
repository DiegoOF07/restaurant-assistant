export type Tone = 'ok' | 'warn' | 'error' | 'info'

export interface Summary {
  tone: Tone
  title: string
  lines: string[]
  items?: { label: string; value: string; tone?: Tone }[]
}

export interface ConfirmationText {
  question: string
  details: string[]
  confirmLabel: string
}

/** id interno -> nombre que entiende el personal */
export type Names = ReadonlyMap<string, string>

export interface ToolResultLike {
  content?: { type: string; text: string }[]
  structuredContent?: unknown
  isError?: boolean
}
