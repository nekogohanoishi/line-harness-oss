export type AutoReplyMessageType = 'text' | 'flex' | 'image'
export type DeliveryMode = 'immediate' | 'delay' | 'clock'
export type JsonPath = Array<string | number>

export interface EditableSequenceMessage extends Record<string, unknown> {
  messageType: AutoReplyMessageType
  messageContent: string
  delaySeconds?: number
  deliveryTimeJst?: string
  sameDayCutoffTimeJst?: string
}

export interface EditableSequenceDocument extends Record<string, unknown> {
  messages: EditableSequenceMessage[]
}

export interface FlexTextField {
  path: JsonPath
  section: 'header' | 'body' | 'footer' | 'other'
  text: string
}

export interface FlexButtonField {
  actionPath: JsonPath
  label: string
  actionType: 'message' | 'uri' | 'postback'
  actionValue: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isMessageType(value: unknown): value is AutoReplyMessageType {
  return value === 'text' || value === 'flex' || value === 'image'
}

export function parseSequenceDocument(raw: string): EditableSequenceDocument {
  const parsed = JSON.parse(raw) as unknown
  if (!isRecord(parsed) || !Array.isArray(parsed.messages)) {
    throw new Error('複数メッセージのデータ形式が正しくありません')
  }
  if (parsed.messages.length === 0 || parsed.messages.length > 5) {
    throw new Error('メッセージは1〜5通で設定してください')
  }

  const messages = parsed.messages.map((message, index) => {
    if (!isRecord(message) || !isMessageType(message.messageType) || typeof message.messageContent !== 'string') {
      throw new Error(`${index + 1}通目のデータ形式が正しくありません`)
    }
    return message as EditableSequenceMessage
  })

  return { ...parsed, messages }
}

export function stringifySequenceDocument(document: EditableSequenceDocument): string {
  return JSON.stringify(document)
}

export function getDeliveryMode(message: EditableSequenceMessage): DeliveryMode {
  if (message.deliveryTimeJst && message.sameDayCutoffTimeJst) return 'clock'
  if ((message.delaySeconds ?? 0) > 0) return 'delay'
  return 'immediate'
}

export function setDeliveryMode(
  message: EditableSequenceMessage,
  mode: DeliveryMode,
): EditableSequenceMessage {
  const next = { ...message }
  delete next.delaySeconds
  delete next.deliveryTimeJst
  delete next.sameDayCutoffTimeJst

  if (mode === 'immediate') next.delaySeconds = 0
  if (mode === 'delay') next.delaySeconds = 60
  if (mode === 'clock') {
    next.deliveryTimeJst = '20:00'
    next.sameDayCutoffTimeJst = '18:00'
  }
  return next
}

export function defaultSequenceMessage(messageType: AutoReplyMessageType = 'text'): EditableSequenceMessage {
  if (messageType === 'flex') {
    return {
      messageType,
      messageContent: JSON.stringify({
        type: 'bubble',
        size: 'mega',
        body: {
          type: 'box',
          layout: 'vertical',
          paddingAll: 'lg',
          contents: [{ type: 'text', text: '', size: 'md', color: '#111827', wrap: true }],
        },
      }),
      delaySeconds: 0,
    }
  }
  if (messageType === 'image') {
    return {
      messageType,
      messageContent: JSON.stringify({ originalContentUrl: '', previewImageUrl: '' }),
      delaySeconds: 0,
    }
  }
  return { messageType, messageContent: '', delaySeconds: 0 }
}

export function changeSequenceMessageType(
  message: EditableSequenceMessage,
  messageType: AutoReplyMessageType,
): EditableSequenceMessage {
  const replacement = defaultSequenceMessage(messageType)
  const mode = getDeliveryMode(message)
  return {
    ...setDeliveryMode(replacement, mode),
    messageType,
  }
}

function sectionFromPath(path: JsonPath): FlexTextField['section'] {
  const first = path[0]
  if (first === 'header' || first === 'body' || first === 'footer') return first
  return 'other'
}

export function collectFlexTextFields(root: unknown): FlexTextField[] {
  const fields: FlexTextField[] = []
  const visit = (value: unknown, path: JsonPath) => {
    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, [...path, index]))
      return
    }
    if (!isRecord(value)) return
    if (value.type === 'text' && typeof value.text === 'string' && value.text !== '→') {
      fields.push({ path: [...path, 'text'], section: sectionFromPath(path), text: value.text })
    }
    Object.entries(value).forEach(([key, item]) => {
      if (key !== 'text') visit(item, [...path, key])
    })
  }
  visit(root, [])
  return fields
}

export function collectFlexButtonFields(root: unknown): FlexButtonField[] {
  const fields: FlexButtonField[] = []
  const visit = (value: unknown, path: JsonPath) => {
    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, [...path, index]))
      return
    }
    if (!isRecord(value)) return
    if (value.type === 'button' && isRecord(value.action)) {
      const action = value.action
      const actionType = action.type
      if (actionType === 'message' || actionType === 'uri' || actionType === 'postback') {
        const actionValue = actionType === 'message'
          ? action.text
          : actionType === 'uri'
            ? action.uri
            : action.data
        fields.push({
          actionPath: [...path, 'action'],
          label: typeof action.label === 'string' ? action.label : '',
          actionType,
          actionValue: typeof actionValue === 'string' ? actionValue : '',
        })
      }
    }
    Object.entries(value).forEach(([key, item]) => visit(item, [...path, key]))
  }
  visit(root, [])
  return fields
}

export function updateJsonAtPath<T>(root: T, path: JsonPath, nextValue: unknown): T {
  const clone = structuredClone(root)
  let cursor: unknown = clone
  for (let index = 0; index < path.length - 1; index += 1) {
    const key = path[index]
    if ((!isRecord(cursor) && !Array.isArray(cursor)) || cursor[key as never] === undefined) {
      throw new Error('編集対象が見つかりません')
    }
    cursor = cursor[key as never]
  }
  const last = path[path.length - 1]
  if (!isRecord(cursor) && !Array.isArray(cursor)) throw new Error('編集対象が見つかりません')
  cursor[last as never] = nextValue as never
  return clone
}

export function updateFlexButton(
  root: unknown,
  field: FlexButtonField,
  updates: Partial<Pick<FlexButtonField, 'label' | 'actionType' | 'actionValue'>>,
): unknown {
  const next = { ...field, ...updates }
  const action: Record<string, string> = { type: next.actionType, label: next.label }
  if (next.actionType === 'message') action.text = next.actionValue
  if (next.actionType === 'uri') action.uri = next.actionValue
  if (next.actionType === 'postback') {
    action.data = next.actionValue
    action.displayText = next.label
  }
  return updateJsonAtPath(root, field.actionPath, action)
}
