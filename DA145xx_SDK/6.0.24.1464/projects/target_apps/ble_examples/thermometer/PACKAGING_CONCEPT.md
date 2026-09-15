# Wearable Packaging Concept — Axillary Body-Temperature Sensor

Product concept for packaging the DA14535MOD-based thermometer firmware (this
project) as a wearable, worn under the armpit to measure body temperature
overnight or longer — for adults and for babies, including very small babies,
so that parents have peace of mind.

Reference product / proof of concept: **TempTraq** — a soft axillary patch
thermometer used on infants for 24–72 h continuous monitoring.

---

## 1. Overall form factor

- Soft, pebble-shaped patch: **~25–30 mm diameter, 6–8 mm thick, < 10 g**.
- At this size and weight it sits in the axilla without pressure marks and a
  baby can lie on it without discomfort.
- The DA14535MOD is ~13 × 13 mm; module + sensor + battery stack comfortably
  in this envelope.

## 2. Thermal path — the part that touches the skin

The most important design detail, and it changes the sensor choice:

| Element | Choice | Why |
|---------|--------|-----|
| Sensor | **TI TMP117** (or Maxim MAX30208) | ±0.1 °C over the medical range, tiny, I2C — near drop-in replacement for the existing async I2C driver. The current AHT20 measures *air* temperature/humidity, reacts slowly in an enclosure, and is the wrong sensor for skin contact. |
| Skin interface | Stainless-steel or anodized-aluminum disc, 10–15 mm, exposed through the enclosure bottom | Conducts skin heat directly into the sensor. |
| Sensor bond | Thermally conductive epoxy or gap-filler pad between disc and sensor | Low-resistance thermal path. |
| Top-side insulation | A few mm of closed-cell foam between sensor and electronics/battery | Prevents room air from pulling the reading down. Good top insulation is what makes axillary readings track core temperature within a few tenths of a degree. |
| Calibration | Fixed offset in firmware | Compensates the remaining skin-to-core offset. |

**Antenna caution:** keep the metal disc away from the DA14535MOD's integrated
antenna edge — respect the module's antenna keep-out zone or BLE range through
a mattress/blanket will suffer.

## 3. Battery

Average draw with extended sleep and a 1–5 min reporting interval is on the
order of **10–30 µA**.

| Option | Runtime | Verdict |
|--------|---------|---------|
| CR2032 coin cell (~225 mAh) | Months | Only acceptable in a fully sealed (ultrasonically welded), non-openable enclosure — a swallowed CR2032 is a life-threatening emergency for a child. Device becomes disposable when the cell dies. |
| **LiPo 40–100 mAh, sealed, rechargeable** | ~1 week of nights per charge (50 mAh) | **Recommended.** Charges via two waterproof pogo/magnetic contacts (no port, nothing openable). Removes the swallow hazard entirely. This is the approach used by Owlet-style baby wearables. |

## 4. Enclosure

- Rigid core: medical-grade PC or ABS carrying PCB, battery, and thermal disc.
- **Full soft-silicone overmold** — skin-safe, soft-edged, nothing for a baby
  to chew off; doubles as the environmental seal.
- **IPX7** — sweat, drool, and cleaning with alcohol wipes are all givens.
- No seams, no screws, no parts smaller than the choke-test cylinder.
  One-piece look, rounded everywhere.

## 5. Keeping it in place overnight

### Adults
- Disposable medical adhesive ring — the device clicks into a fresh adhesive
  frame each night; or an elastic band.

### Babies — avoid straps entirely (strangulation risk)
- **Gentle-adhesive patch:** silicone-based "gentle to skin" medical adhesives
  (e.g. 3M 2477P family) are designed for neonatal skin and peel off without
  damage. The device snaps into a disposable adhesive carrier; the cheap
  carrier is replaced nightly, not the electronics.
- **Garment integration:** a onesie or sleep sack with a small fabric pocket
  sewn under the armpit holding the sensor disc against the skin. Zero
  adhesive, zero straps — often the best answer for very small / preterm
  babies whose skin is too fragile even for gentle adhesives.

## 6. System behavior for "peace of mind"

The current firmware (periodic HTP indications, extended sleep between) fits
this use case. Recommended firmware additions, all doable in this codebase:

- 1–5 min measurement interval instead of 5 s.
- Temperature-threshold alarms pushed to the phone.
- Low-battery flag in the advertising data.
- Broadcast the temperature in advertisements (non-connectable) so a bedside
  tablet/gateway can log it without holding a connection — lower power and
  more robust when the phone wanders out of range.

## 7. Regulatory caveat

Marketed for measuring a baby's body temperature (rather than "wellness
tracking"), this is a **medical device**:

- USA: Class II, FDA 510(k).
- EU: Class IIa under MDR.
- Accuracy validation: ISO 80601-2-56.
- Biocompatibility of skin-contact materials: ISO 10993.
- Battery/electrical safety requirements apply.

A "wellness, not diagnostic" positioning softens but does not eliminate this.

## 8. Possible next steps

1. TMP117 driver replacing the AHT20 one (the async I2C layer in
   `src/i2c_temp_sensor.c` carries over almost unchanged).
2. Longer-interval + advertising-broadcast firmware changes.
3. Bill of materials for a first prototype build.
4. **Per-unit provisioning line.** Every unit needs its own Bluetooth
   device address burned into the DA14535 OTP header before it leaves the
   bench: the firmware's `CFG_NVDS_TAG_BD_ADDRESS` is only a fallback that
   every unit built from this source (and the SDK examples) shares, so two
   unprovisioned units are indistinguishable to collectors and to the
   platform's device registry (`devices.bd_addr` is unique). Allocate
   addresses from an IEEE-registered OUI block, record the mapping
   serial → address for the fleet registry, and program it with
   SmartSnippets Toolbox (OTP Header) or the Renesas Flash Programmer CLI
   as part of the same step that burns the production firmware image. The
   same station is where a per-device pairing/OTA credential would be
   provisioned once that exists (`proposals.md` §10.1) and, if BLE privacy
   (resolvable private addresses) is ever enabled, where the per-device IRK
   is generated — the firmware refuses to build a privacy mode with the
   placeholder IRK (`src/config/user_config.h`).
