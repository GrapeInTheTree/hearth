import { ValidationError } from '@hearth/shared';
import { describe, expect, it } from 'vitest';

import { decode, encode, matchesAction } from '../../../src/lib/customId.js';

describe('customId', () => {
  it('roundtrips panel:open payload', () => {
    const id = encode('panel:open', { panelId: 'p1', typeId: 't1' });
    expect(decode(id, 'panel:open')).toEqual({ panelId: 'p1', typeId: 't1' });
  });

  it('roundtrips ticket actions', () => {
    const id = encode('ticket:claim', { ticketId: 'tk1' });
    expect(decode(id, 'ticket:claim')).toEqual({ ticketId: 'tk1' });
  });

  it('rejects encoded length > 100', () => {
    const longId = 'x'.repeat(120);
    expect(() => encode('ticket:close', { ticketId: longId })).toThrow(ValidationError);
  });

  it('rejects decode when action mismatches', () => {
    const id = encode('ticket:claim', { ticketId: 'tk1' });
    expect(() => decode(id, 'ticket:close')).toThrow(ValidationError);
  });

  it('rejects decode of malformed JSON payload', () => {
    expect(() => decode('ticket:claim|{not-json', 'ticket:claim')).toThrow(ValidationError);
  });

  it('rejects decode when payload schema fails (missing key)', () => {
    expect(() => decode('ticket:claim|{}', 'ticket:claim')).toThrow(ValidationError);
  });

  it('rejects decode when separator missing', () => {
    expect(() => decode('panel:open', 'panel:open')).toThrow(ValidationError);
  });

  it('matchesAction is true only for exact prefix', () => {
    const id = encode('ticket:close', { ticketId: 'tk1' });
    expect(matchesAction(id, 'ticket:close')).toBe(true);
    expect(matchesAction(id, 'ticket:claim')).toBe(false);
  });
});
