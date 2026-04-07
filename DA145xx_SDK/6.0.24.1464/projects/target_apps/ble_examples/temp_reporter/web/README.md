# DA14531 Temperature Monitor Web App

A web-based Bluetooth Low Energy (BLE) interface for connecting to and monitoring the DA14531 temperature sensor device.

## Features

- 🔍 **Device Scanning**: Automatically scan for and connect to DLG_TEMPR devices
- 🌡️ **Real-time Temperature**: Display live temperature readings from the DA14531 device
- ⏱️ **Configurable Intervals**: Adjust measurement intervals from 1-60 seconds
- 📊 **Connection Monitoring**: Real-time connection status and logging
- 📱 **Responsive Design**: Works on desktop and mobile browsers

## Requirements

### Browser Support
- **Chrome** (recommended)
- **Microsoft Edge**
- **Other Chromium-based browsers**

**Note**: Safari and Firefox have limited Web Bluetooth support.

### Hardware Requirements
- MacBook Air M1 (or any computer with Bluetooth support)
- DA14531 development board with the temperature reporter firmware

## Setup Instructions

### 1. Prepare the DA14531 Device
1. Flash the `temp_reporter.hex` firmware to your DA14531 device
2. Ensure the device is powered on and advertising as "DLG_TEMPR"
3. The device should be using P0_6 as ADC input for temperature sensing

### 2. Run the Web Application

#### Option A: Local File Server (Recommended)
```bash
# Navigate to the web directory
cd /path/to/temp_reporter/web

# Start a simple HTTP server (Python 3)
python3 -m http.server 8000

# Or using Node.js
npx http-server -p 8000

# Or using PHP
php -S localhost:8000
```

Then open: `http://localhost:8000`

#### Option B: Direct File Access
Open `index.html` directly in your browser (may have limitations with some browsers).

## Usage Guide

### 1. Connect to Device
1. Click **"Scan & Connect"** button
2. Select "DLG_TEMPR" from the device list
3. Wait for connection to establish

### 2. Monitor Temperature
- Temperature readings will appear automatically every 5 seconds (default)
- Values are displayed in Celsius with one decimal place
- Last update time is shown below the temperature

### 3. Configure Measurement Interval
1. Use the slider to select desired interval (1-60 seconds)
2. Click **"Update Interval"** to apply changes
3. The device will start using the new measurement frequency

### 4. Monitor Connection
- Connection status is shown with colored indicator:
  - 🔴 Red: Disconnected
  - 🟡 Yellow: Connecting
  - 🟢 Green: Connected
- All activities are logged in the connection log section

## Technical Details

### BLE Services and Characteristics
- **Service**: Health Thermometer Service (0x1809)
- **Temperature Measurement**: 0x2A1C (Indications)
- **Measurement Interval**: 0x2A21 (Read/Write)

### Data Format
- Temperature data follows IEEE-11073 format
- Measurement intervals are in seconds (uint16)
- Temperature range: 36-40°C (simulated from ADC input)

## Troubleshooting

### Connection Issues
1. **Device not found**: Ensure DA14531 is powered and advertising
2. **Connection fails**: Try refreshing the page and reconnecting
3. **No temperature data**: Check that indications are enabled

### Browser Issues
1. **Web Bluetooth not supported**: Use Chrome or Edge browser
2. **Permission denied**: Allow Bluetooth access when prompted
3. **HTTPS required**: Some browsers require HTTPS for Web Bluetooth

### Device Issues
1. **No advertising**: Check DA14531 power and firmware
2. **Wrong device name**: Ensure firmware is configured for "DLG_TEMPR"
3. **Service not found**: Verify Health Thermometer Profile is enabled

## Development

### File Structure
```
web/
├── index.html          # Main HTML interface
├── style.css           # CSS styling
├── app.js             # JavaScript Web Bluetooth logic
└── README.md          # This documentation
```

### Key JavaScript Classes
- `TemperatureMonitor`: Main application class
- Web Bluetooth API integration
- IEEE-11073 temperature format parsing
- Real-time UI updates

## Browser Compatibility

| Browser | macOS Support | Notes |
|---------|---------------|-------|
| Chrome | ✅ Full | Recommended |
| Edge | ✅ Full | Chromium-based |
| Safari | ⚠️ Limited | Experimental support |
| Firefox | ❌ None | No Web Bluetooth |

## Security Notes

- Web Bluetooth requires user interaction to initiate connections
- Only works over HTTPS in production environments
- Device pairing is handled by the browser
- No sensitive data is transmitted or stored

## License

This web application is part of the DA14531 temperature reporter project and follows the same licensing terms as the embedded firmware.
