package sensor

import "errors"

// NewBlueZSource would subscribe to a real DA145xx thermometer's HTP
// indications over Linux's BlueZ Bluetooth stack. Not implemented in this
// scaffold — see ../../README.md, "What's implemented vs. scaffolded". The
// Source interface is already in place so this can be filled in later
// without touching main.go or the MQTT/envelope code at all.
func NewBlueZSource(deviceAddress string) (Source, error) {
	return nil, errors.New("BlueZ source not implemented for device " + deviceAddress + " — run with --simulate, or see gateway/README.md")
}
