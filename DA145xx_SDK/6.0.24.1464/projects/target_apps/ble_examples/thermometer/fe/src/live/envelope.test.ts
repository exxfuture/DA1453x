import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import Ajv2020, { type ValidateFunction } from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildTemperatureEnvelope, WEB_COLLECTOR_ID, type MeasurementEnvelope } from './envelope';

/**
 * Parity test for the shared wire format (review INF-07).
 *
 * The schema is READ FROM DISK, never copied here — that is the whole point:
 * `schema/measurement-envelope.v1.schema.json` is the single source of truth
 * shared with the Go gateway and the Java backend, each of which carries the
 * equivalent test against the same file. A field rename on any side therefore
 * fails a test on the other two instead of silently desyncing the pipeline.
 */
const SCHEMA_RELATIVE_PATH = join('schema', 'measurement-envelope.v1.schema.json');

/**
 * Walks up from the working directory to the project root holding `schema/`.
 * `import.meta.url` is not a file URL under vitest's jsdom environment, and a
 * fixed `../../../` would break the moment this file moves — so the anchor is
 * the schema itself.
 */
function findSchema(): string {
  let dir = resolve(process.cwd());
  for (let i = 0; i < 8; i += 1) {
    const candidate = join(dir, SCHEMA_RELATIVE_PATH);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(
    `Could not find ${SCHEMA_RELATIVE_PATH} above ${process.cwd()} — it is the shared source of truth for the wire format (review INF-07) and this test is meaningless without it.`,
  );
}

let validate: ValidateFunction;

function errorText(): string {
  return (validate.errors ?? []).map((e) => `${e.instancePath || '/'} ${e.message ?? ''}`).join('; ');
}

/** Asserts validity and, on failure, reports which keyword rejected it. */
function expectValid(envelope: unknown): void {
  const ok = validate(envelope);
  expect(ok, errorText()).toBe(true);
}

function expectInvalid(envelope: unknown): void {
  expect(validate(envelope)).toBe(false);
}

beforeAll(() => {
  const schema: unknown = JSON.parse(readFileSync(findSchema(), 'utf8'));
  // Draft 2020-12, as the schema's own $schema declares. addFormats supplies the
  // `ts` field's "date-time".
  //
  // `strictTypes: false` because the schema's conditional `allOf` branches
  // constrain `payload`'s `required`/`properties` without restating
  // `"type": "object"` — valid JSON Schema, and only Ajv's optional strict-mode
  // *style* check objects. The schema is shared with Go and Java (which use
  // different validators) so it is not this test's place to bend it to Ajv;
  // every other strict check stays on.
  const ajv = new Ajv2020({ strict: true, strictTypes: false, allErrors: true });
  addFormats(ajv);
  validate = ajv.compile(schema as object);
});

describe('measurement envelope schema parity', () => {
  it('accepts what buildTemperatureEnvelope() produces', () => {
    const envelope = buildTemperatureEnvelope('AA:BB:CC:DD:EE:FF', 36.84, new Date('2026-09-14T08:30:00.000Z'));
    expectValid(envelope);

    // The fields the rest of the pipeline keys off, pinned explicitly so a
    // rename is caught here and not by a broker ACL at runtime.
    expect(envelope).toEqual({
      v: 1,
      device_id: 'AA:BB:CC:DD:EE:FF',
      collector_id: 'web-fe',
      ts: '2026-09-14T08:30:00.000Z',
      type: 'temperature',
      payload: { celsius: 36.84 },
    });
    // `meta` is omitted, not null — the schema's description says so and the
    // Java record deserialises a null differently from an absent key.
    expect('meta' in envelope).toBe(false);
  });

  it("declares this app's collector id", () => {
    expect(WEB_COLLECTOR_ID).toBe('web-fe');
    expect(buildTemperatureEnvelope('AA:BB:CC:DD:EE:FF', 37).collector_id).toBe(WEB_COLLECTOR_ID);
  });

  it('accepts the realistic sensor range end to end', () => {
    for (const celsius of [-40, 0, 36.5, 37.2, 40.1, 85]) {
      expectValid(buildTemperatureEnvelope('11:22:33:44:55:66', celsius));
    }
  });

  it('produces an RFC 3339 UTC timestamp the schema pattern accepts', () => {
    const envelope = buildTemperatureEnvelope('11:22:33:44:55:66', 37);
    expect(envelope.ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expectValid(envelope);
  });

  it('accepts an envelope carrying collector meta', () => {
    const envelope: MeasurementEnvelope = {
      ...buildTemperatureEnvelope('11:22:33:44:55:66', 37),
      meta: { battery_pct: 82, rssi_dbm: -61, fw_version: '1.2.3' },
    };
    expectValid(envelope);
  });

  // The negative cases matter as much as the positive ones: they are what proves
  // the schema is actually constraining the format rather than accepting
  // anything shaped like an object.
  describe('the schema rejects what the pipeline must not accept', () => {
    const valid = (): Record<string, unknown> => ({ ...buildTemperatureEnvelope('AA:BB:CC:DD:EE:FF', 37) });

    it.each(['v', 'device_id', 'collector_id', 'ts', 'type', 'payload'])('a missing %s', (field) => {
      const envelope = valid();
      delete envelope[field];
      expectInvalid(envelope);
    });

    it('a device_id longer than devices.bd_addr (17 chars)', () => {
      expectInvalid({ ...valid(), device_id: 'AA:BB:CC:DD:EE:FF:00' });
    });

    it('an empty payload', () => {
      expectInvalid({ ...valid(), payload: {} });
    });

    it('a temperature payload with no celsius', () => {
      expectInvalid({ ...valid(), payload: { fahrenheit: 98.6 } });
    });

    it('a non-finite celsius (JSON has no NaN, so it arrives as a string or null)', () => {
      expectInvalid({ ...valid(), payload: { celsius: null } });
      expectInvalid({ ...valid(), payload: { celsius: 'NaN' } });
    });

    it('a physically impossible celsius', () => {
      expectInvalid({ ...valid(), payload: { celsius: -300 } });
    });

    it('an envelope version other than 1', () => {
      expectInvalid({ ...valid(), v: 2 });
    });

    it('a timestamp without an offset', () => {
      expectInvalid({ ...valid(), ts: '2026-09-14T08:30:00' });
    });

    it('a type that is not a lower-snake-case token', () => {
      expectInvalid({ ...valid(), type: 'Temperature' });
      expectInvalid({ ...valid(), type: '' });
    });
  });
});
