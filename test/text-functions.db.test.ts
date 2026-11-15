/**
 * The text keys and the postcode fold, by behaviour (#32): the charging
 * register's street, house and operator keys and its four extras readers,
 * vf_postcode, and the postcode trigger on each table that carries one.
 *
 *   TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:5432/empty npm run test:db
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DomainDb } from "./domain-db.js";
import { one, requireDb, rows, url } from "./schema-db.js";

requireDb("the text keys and the postcode fold");

describe.skipIf(url === undefined)("the text keys and the postcode fold", () => {
  const t = new DomainDb(url ?? "postgresql://x@127.0.0.1/x", "text_fn");

  beforeAll(async () => {
    await t.make([]);
  }, 900_000);

  afterAll(async () => {
    await t.drop();
  });

  const each = async (fn: string, inputs: (string | null)[]): Promise<(string | null)[]> =>
    (await rows<{ x: string | null }>(t.pool, `select ${fn}(i)::text as x from unnest($1::text[]) with ordinality u(i, n) order by n`, [inputs])).map((r) => r.x);

  it("charging_street_key: lower case, ß as ss, Straße/Str. folded to str, everything but letters dropped", async () => {
    expect(await each("charging_street_key", ["Hauptstraße 5", "Hauptstr. 5", "Haupt-Strasse", "Am Ölberg", null])).toEqual(["hauptstr", "hauptstr", "hauptstr", "amölberg", ""]);
  });

  it("charging_house_key: the first number of the house number, else of the street; none is null", async () => {
    const r = await rows<{ x: string | null }>(
      t.pool,
      "select charging_house_key(s, h) as x from (values ('Hauptstr. 5', '12a'), ('Hauptstr. 5', null), ('Hauptstr. 5', ''), ('Hauptstr.', 'b'), (null, null)) v(s, h)",
    );
    expect(r.map((x) => x.x)).toEqual(["12", "5", "5", null, null]);
  });

  it("charging_operator_tokens: distinct sorted words of three letters or more, legal forms and filler words dropped", async () => {
    const r = await one<{ a: string[]; b: string[]; c: string[] }>(
      t.pool,
      "select charging_operator_tokens('Stadtwerke München GmbH & Co. KG') as a, charging_operator_tokens('EnBW mobility+ AG, EnBW') as b, charging_operator_tokens(null) as c",
    );
    expect(r).toEqual({ a: ["münchen"], b: ["enbw"], c: [] });
  });

  it("the register's extras: free of charge and card from the payment text, the opening hours and the parking by their register words", async () => {
    const r = await rows<Record<string, unknown>>(
      t.pool,
      `select charging_register_free_of_charge(x) as free, charging_register_payment_card(x) as card, charging_register_opening_hours(x) as hours, charging_register_parking(x) as parking
         from (values ('{"device": {"payment": "Kostenlos", "openingHours": "247", "parking": " Keine Beschränkung "}}'::jsonb),
                      ('{"device": {"payment": "Bargeld; Kostenlos;Kreditkarte", "openingHours": "Eingeschränkt", "parking": "Nur für Kunden"}}'),
                      ('{"device": {"payment": "Debitkarte", "openingHours": "Mo-Fr", "parking": "Anwohner"}}'),
                      ('{"device": {"payment": "  "}}'), ('{}')) v(x)`,
    );
    expect(r).toEqual([
      { free: true, card: false, hours: "always", parking: "public" },
      { free: true, card: true, hours: "restricted", parking: "customers" },
      { free: false, card: true, hours: null, parking: null },
      { free: null, card: null, hours: null, parking: null },
      { free: null, card: null, hours: null, parking: null },
    ]);
  });

  it("vf_postcode: five digits trimmed, four digits get their leading zero, the one five-digit group of a longer text, else null", async () => {
    expect(await each("vf_postcode", [" 50667\t", "1067", "D-50667 Köln", "50667 Köln 50668", "506670", "123", "", null, " 01067 "])).toEqual([
      "50667",
      "01067",
      "50667",
      null,
      null,
      null,
      null,
      null,
      "01067",
    ]);
  });

  it("the postcode trigger folds on insert and on a postcode update, on every table that carries one", async () => {
    await t.planted(async (c) => {
      await c.query("insert into charging_sites (source_feed, site_id, geom, postcode) values ('f', 's1', ST_MakePoint(7, 50)::geography, 'D-50667 Köln')");
      await c.query("insert into fuel_stations (id, geom, postcode) values ('fs1', ST_MakePoint(7, 50)::geography, '1067')");
      await c.query(
        "insert into street_bays (bay_id, external_id, kind, geom, first_seen_at, last_seen_at, source_feed, source_publisher, postcode) values ('dortmund:e1', 'e1', 'ev_charging', ST_MakePoint(7, 50)::geography, now(), now(), 'dortmund_parksensoren_bays', 'p', ' 20095 ')",
      );
      const read = async (): Promise<(string | null)[]> =>
        (
          await rows<{ p: string | null }>(
            c,
            "select postcode as p from charging_sites union all select postcode from fuel_stations union all select postcode from street_bays",
          )
        ).map((x) => x.p);
      expect(await read()).toEqual(["50667", "01067", "20095"]);
      await c.query("update charging_sites set postcode = 'unbekannt'");
      await c.query("update fuel_stations set postcode = '80331 München'");
      await c.query("update street_bays set postcode = '2009'");
      expect(await read()).toEqual([null, "80331", "02009"]);
    });
  });
});
