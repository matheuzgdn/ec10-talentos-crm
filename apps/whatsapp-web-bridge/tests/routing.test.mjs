import test from "node:test";
import assert from "node:assert/strict";
import { detectLanguage, inferService, selectSeller, buildSellerNotification } from "../src/routing.mjs";

test("Spanish always routes to Augustin", () => {
  const language = detectLanguage([{ direction: "inbound", text: "Hola, soy el responsable y quiero agendar" }], "5531");
  const seller = selectSeller({ language, athleteAge: 22, serviceInterest: "plano_internacional" });
  assert.equal(language, "es");
  assert.equal(seller.name, "Augustin");
  assert.equal(seller.phone, "5493513804731");
});

test("Portuguese adult is international and routes to Pablo", () => {
  assert.equal(inferService({ language: "pt", athleteAge: 18, explicitService: "plano_carreira" }), "plano_internacional");
  assert.equal(selectSeller({ language: "pt", athleteAge: 18 }).name, "Pablo");
});

test("Portuguese minor career meeting routes to Igor", () => {
  assert.equal(inferService({ language: "pt", athleteAge: 15 }), "plano_carreira");
  assert.equal(selectSeller({ language: "pt", athleteAge: 15, serviceInterest: "plano_carreira" }).name, "Igor Jardins");
});

test("seller notification contains confirmed appointment facts", () => {
  const text = buildSellerNotification({
    seller: selectSeller({ language: "pt", athleteAge: 19 }), contactName: "Bruno", athleteName: "Marcelo",
    athleteAge: 19, phone: "5531999999999", booking: { starts_at: "2026-09-24T23:00:00.000Z", service_label: "Plano Internacional" }
  });
  assert.match(text, /20:00/);
  assert.match(text, /Bruno/);
  assert.match(text, /Marcelo/);
  assert.match(text, /Pablo/);
});
