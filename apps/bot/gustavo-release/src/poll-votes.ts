import { createHash } from 'node:crypto';

export function serializeWhatsAppKey(value: any): string {
  if (typeof value === 'string') return value.trim();
  if (!value) return '';
  for (const key of ['_serialized', '$1']) {
    if (typeof value[key] === 'string') return value[key];
  }
  if (typeof value.user === 'string' && typeof value.server === 'string') return `${value.user}@${value.server}`;
  const text = typeof value.toString === 'function' ? value.toString() : '';
  return text && text !== '[object Object]' ? text : '';
}

export function pollParentId(vote: any): string {
  return serializeWhatsAppKey(vote.parentMessage?.id)
    || serializeWhatsAppKey(vote.parentMsgKey)
    || serializeWhatsAppKey(vote.pollCreationMessageKey)
    || serializeWhatsAppKey(vote.pollUpdateParentKey);
}

export function normalizePollVote(vote: any, parent?: any) {
  const options = parent?.pollOptions ?? vote.parentMessage?.pollOptions ?? [];
  const ids = Array.from(vote.selectedOptionLocalIds ?? []) as number[];
  const selected = vote.selectedOptions ?? ids.map(localId => ({ localId }));
  const names = selected.map((option: any) => {
    if (typeof option === 'string') return option;
    return option?.name || options.find((p: any) => Number(p.localId ?? p.id) === Number(option?.localId ?? option?.id))?.name;
  }).filter((name: any): name is string => typeof name === 'string' && !!name.trim()).map((name: string) => name.trim());
  return {
    voter: serializeWhatsAppKey(vote.voter ?? vote.sender ?? vote.senderUserJid ?? vote.author ?? vote.from),
    parentId: pollParentId(vote) || serializeWhatsAppKey(parent?.id),
    names: [...new Set<string>(names)],
    timestamp: Number(vote.interractedAtTs ?? vote.senderTimestampMs ?? vote.timestamp ?? vote.t ?? 0)
  };
}

export function pollVoteMessageId(vote: ReturnType<typeof normalizePollVote>, phone: string) {
  // One answer per poll/contact: changing an old vote cannot advance a later stage.
  const digest = createHash('sha256').update(`${vote.parentId}:${phone}`).digest('hex');
  return `poll-vote:${digest}`;
}

export async function readWhatsAppPollVotes(client: any, messageId: string): Promise<any[]> {
  const parent = await client.getMessageById(messageId);
  if (!parent) return [];
  // Read raw persisted votes instead of PollVote's fragile parent/option constructor.
  const rows = await client.pupPage.evaluate(async (id: string) => {
    const w = window as any;
    const table = w.require('WAWebPollsVotesSchema').getTable();
    const key = w.require('WAWebMsgKey').fromString(id);
    const keys = [...new Set([id, key._serialized, key.$1, key.toString()].filter(k => typeof k === 'string'))];
    const found: any[] = [];
    for (const k of keys) found.push(...await table.equals(['parentMsgKey'], k));
    return found.map(v => ({
      sender: v.sender, senderTimestampMs: v.senderTimestampMs,
      selectedOptionLocalIds: Array.from(new Uint8Array(v.selectedOptionLocalIds)),
      parentMsgKey: id
    }));
  }, messageId);
  return rows.map((row: any) => ({ ...row, parentMessage: parent }));
}
