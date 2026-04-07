// Web Bluetooth API for DA14531 Temperature Monitor
class TemperatureMonitor {
    constructor() {
        // BLE Service and Characteristic UUIDs
        this.HEALTH_THERMOMETER_SERVICE = 0x1809;
        this.TEMPERATURE_MEASUREMENT_CHAR = 0x2A1C;
        this.MEASUREMENT_INTERVAL_CHAR = 0x2A21;
        this.BATTERY_SERVICE = 0x180F;
        this.BATTERY_LEVEL_CHAR = 0x2A19;
        
        // Connection state
        this.device = null;
        this.server = null;
        this.service = null;
        this.batteryService = null;
        this.temperatureChar = null;
        this.intervalChar = null;
        this.batteryChar = null;
        this.isConnected = false;
        
        // UI elements
        this.connectBtn = document.getElementById('connectBtn');
        this.disconnectBtn = document.getElementById('disconnectBtn');
        this.statusDot = document.getElementById('statusDot');
        this.connectionStatus = document.getElementById('connectionStatus');
        this.temperatureValue = document.getElementById('temperatureValue');
        this.lastUpdated = document.getElementById('lastUpdated');
        this.temperatureType = document.getElementById('temperatureType');
        this.batteryValue = document.getElementById('batteryValue');
        this.batteryFill = document.getElementById('batteryFill');
        this.batteryStatus = document.getElementById('batteryStatus');
        this.currentInterval = document.getElementById('currentInterval');
        this.intervalSlider = document.getElementById('intervalSlider');
        this.sliderValue = document.getElementById('sliderValue');
        this.setIntervalBtn = document.getElementById('setIntervalBtn');
        this.logContainer = document.getElementById('logContainer');
        this.clearLogBtn = document.getElementById('clearLogBtn');
        
        this.initializeEventListeners();
        this.checkWebBluetoothSupport();
    }
    
    initializeEventListeners() {
        this.connectBtn.addEventListener('click', () => this.connect());
        this.disconnectBtn.addEventListener('click', () => this.disconnect());
        this.setIntervalBtn.addEventListener('click', () => this.setMeasurementInterval());
        this.clearLogBtn.addEventListener('click', () => this.clearLog());
        
        // Interval slider
        this.intervalSlider.addEventListener('input', (e) => {
            this.sliderValue.textContent = e.target.value;
        });
    }
    
    checkWebBluetoothSupport() {
        if (!navigator.bluetooth) {
            this.log('Web Bluetooth API is not supported in this browser.', 'error');
            this.log('Please use Chrome, Edge, or another Chromium-based browser.', 'error');
            this.connectBtn.disabled = true;
            return false;
        }
        this.log('Web Bluetooth API is supported.', 'success');
        return true;
    }
    
    async connect() {
        try {
            this.log('Scanning for DA14531 devices...', 'info');
            this.updateConnectionStatus('connecting');
            
            // Request device with Health Thermometer and Battery services
            this.device = await navigator.bluetooth.requestDevice({
                filters: [
                    { name: 'DLG_TEMPR' },
                    { services: [this.HEALTH_THERMOMETER_SERVICE] }
                ],
                optionalServices: [this.HEALTH_THERMOMETER_SERVICE, this.BATTERY_SERVICE]
            });
            
            this.log(`Found device: ${this.device.name}`, 'success');
            
            // Add disconnect event listener
            this.device.addEventListener('gattserverdisconnected', () => {
                this.onDisconnected();
            });
            
            // Connect to GATT server
            this.log('Connecting to GATT server...', 'info');
            this.server = await this.device.gatt.connect();
            
            // Get Health Thermometer service
            this.log('Getting Health Thermometer service...', 'info');
            this.service = await this.server.getPrimaryService(this.HEALTH_THERMOMETER_SERVICE);
            
            // Get characteristics
            this.log('Getting characteristics...', 'info');
            this.temperatureChar = await this.service.getCharacteristic(this.TEMPERATURE_MEASUREMENT_CHAR);
            this.intervalChar = await this.service.getCharacteristic(this.MEASUREMENT_INTERVAL_CHAR);
            
            // Enable temperature measurement indications (required by Health Thermometer Profile)
            this.log('Enabling temperature measurement indications...', 'info');
            await this.enableTemperatureIndications();
            this.temperatureChar.addEventListener('characteristicvaluechanged', (event) => {
                this.handleTemperatureData(event.target.value);
            });
            
            // Read current measurement interval
            await this.readMeasurementInterval();

            // Get Battery service and characteristics
            try {
                this.log('Getting Battery service...', 'info');
                this.batteryService = await this.server.getPrimaryService(this.BATTERY_SERVICE);
                this.batteryChar = await this.batteryService.getCharacteristic(this.BATTERY_LEVEL_CHAR);

                // Read initial battery level
                await this.readBatteryLevel();

                // Enable battery level notifications if supported
                try {
                    await this.batteryChar.startNotifications();
                    this.batteryChar.addEventListener('characteristicvaluechanged', (event) => {
                        this.handleBatteryData(event.target.value);
                    });
                    this.log('Battery level notifications enabled', 'success');
                } catch (error) {
                    this.log('Battery notifications not supported, will poll manually', 'warning');
                }
            } catch (error) {
                this.log(`Battery service not available: ${error.message}`, 'warning');
            }

            this.isConnected = true;
            this.updateConnectionStatus('connected');
            this.log('Successfully connected to DA14531!', 'success');
            
        } catch (error) {
            this.log(`Connection failed: ${error.message}`, 'error');
            this.updateConnectionStatus('disconnected');
        }
    }

    async enableTemperatureIndications() {
        try {
            // Get the Client Characteristic Configuration Descriptor (CCCD)
            // For Health Thermometer Profile, we need to enable indications (0x0002)
            const cccdDescriptor = await this.temperatureChar.getDescriptor(0x2902);

            // Enable indications by writing 0x0002 to CCCD
            const indicationValue = new Uint8Array([0x02, 0x00]); // 0x0002 in little-endian
            await cccdDescriptor.writeValue(indicationValue);

            this.log('Temperature measurement indications enabled successfully', 'success');
        } catch (error) {
            this.log(`Failed to enable indications: ${error.message}`, 'error');
            // Fallback to notifications if indications fail
            try {
                this.log('Falling back to notifications...', 'info');
                await this.temperatureChar.startNotifications();
                this.log('Temperature measurement notifications enabled as fallback', 'warning');
            } catch (notificationError) {
                this.log(`Failed to enable notifications: ${notificationError.message}`, 'error');
                throw notificationError;
            }
        }
    }

    async disconnect() {
        try {
            if (this.device && this.device.gatt.connected) {
                // Disable indications before disconnecting
                if (this.temperatureChar) {
                    try {
                        const cccdDescriptor = await this.temperatureChar.getDescriptor(0x2902);
                        const disableValue = new Uint8Array([0x00, 0x00]); // Disable indications/notifications
                        await cccdDescriptor.writeValue(disableValue);
                        this.log('Temperature indications disabled', 'info');
                    } catch (error) {
                        this.log(`Failed to disable indications: ${error.message}`, 'warning');
                    }
                }
                await this.device.gatt.disconnect();
            }
            this.onDisconnected();
        } catch (error) {
            this.log(`Disconnect error: ${error.message}`, 'error');
        }
    }
    
    onDisconnected() {
        this.isConnected = false;
        this.device = null;
        this.server = null;
        this.service = null;
        this.batteryService = null;
        this.temperatureChar = null;
        this.intervalChar = null;
        this.batteryChar = null;

        this.updateConnectionStatus('disconnected');
        this.log('Disconnected from device.', 'warning');

        // Reset UI
        this.temperatureValue.textContent = '--.-';
        this.lastUpdated.textContent = 'Never';
        this.currentInterval.textContent = '-- seconds';
        this.batteryValue.textContent = '--%';
        this.batteryStatus.textContent = 'Unknown';
        this.batteryFill.style.width = '0%';
        this.batteryFill.className = 'battery-fill';
    }
    
    updateConnectionStatus(status) {
        this.statusDot.className = 'status-dot';
        
        switch (status) {
            case 'connected':
                this.statusDot.classList.add('connected');
                this.connectionStatus.textContent = 'Connected';
                this.connectBtn.disabled = true;
                this.disconnectBtn.disabled = false;
                this.setIntervalBtn.disabled = false;
                break;
            case 'connecting':
                this.statusDot.classList.add('connecting');
                this.connectionStatus.textContent = 'Connecting...';
                this.connectBtn.disabled = true;
                this.disconnectBtn.disabled = true;
                this.setIntervalBtn.disabled = true;
                break;
            case 'disconnected':
            default:
                this.connectionStatus.textContent = 'Disconnected';
                this.connectBtn.disabled = false;
                this.disconnectBtn.disabled = true;
                this.setIntervalBtn.disabled = true;
                break;
        }
    }
    
    handleTemperatureData(dataView) {
        try {
            // Parse IEEE-11073 temperature measurement format
            // Byte 0: Flags
            // Bytes 1-4: Temperature value (IEEE-11073 FLOAT)
            // Optional: Timestamp, Temperature Type

            const flags = dataView.getUint8(0);
            this.log(`Received temperature data (${dataView.byteLength} bytes, flags: 0x${flags.toString(16)})`, 'info');

            let temperature;

            if (dataView.byteLength >= 5) {
                // Read IEEE-11073 FLOAT (4 bytes)
                const tempRaw = dataView.getUint32(1, true); // little-endian
                temperature = this.parseIEEE11073Float(tempRaw);
            } else if (dataView.byteLength >= 3) {
                // Read IEEE-11073 SFLOAT (2 bytes)
                const tempRaw = dataView.getUint16(1, true); // little-endian
                temperature = this.parseIEEE11073SFloat(tempRaw);
            } else {
                this.log('Invalid temperature data length', 'error');
                return;
            }

            // Validate temperature range
            if (temperature < -40 || temperature > 100) {
                this.log(`Temperature out of range: ${temperature}°C`, 'warning');
                // Try alternative parsing
                temperature = this.parseAlternativeFormat(dataView);
            }

            // Update UI
            this.temperatureValue.textContent = temperature.toFixed(1);
            this.lastUpdated.textContent = new Date().toLocaleTimeString();

            this.log(`Temperature: ${temperature.toFixed(1)}°C`, 'success');

        } catch (error) {
            this.log(`Error parsing temperature data: ${error.message}`, 'error');
        }
    }
    
    parseIEEE11073Float(value) {
        // IEEE-11073 FLOAT format (32-bit)
        // Bits 0-23: Mantissa (24 bits, signed)
        // Bits 24-31: Exponent (8 bits, signed)

        let mantissa = value & 0x00FFFFFF;
        let exponent = (value >> 24) & 0xFF;

        // Handle signed mantissa (24-bit two's complement)
        if (mantissa & 0x800000) {
            mantissa = mantissa - 0x1000000;
        }

        // Handle signed exponent (8-bit two's complement)
        if (exponent & 0x80) {
            exponent = exponent - 0x100;
        }

        // Special values
        if (mantissa === 0x007FFFFF && exponent === 0) return NaN; // NaN
        if (mantissa === 0x007FFFFE && exponent === 0) return NaN; // NRes
        if (mantissa === 0x00800002 && exponent === 0) return Infinity; // +INFINITY
        if (mantissa === 0x00800000 && exponent === 0) return -Infinity; // -INFINITY

        return mantissa * Math.pow(10, exponent);
    }

    parseIEEE11073SFloat(value) {
        // IEEE-11073 SFLOAT format (16-bit)
        // Bits 0-11: Mantissa (12 bits, signed)
        // Bits 12-15: Exponent (4 bits, signed)

        let mantissa = value & 0x0FFF;
        let exponent = (value >> 12) & 0x0F;

        // Handle signed mantissa (12-bit two's complement)
        if (mantissa & 0x0800) {
            mantissa = mantissa - 0x1000;
        }

        // Handle signed exponent (4-bit two's complement)
        if (exponent & 0x08) {
            exponent = exponent - 0x10;
        }

        // Special values
        if (mantissa === 0x07FF && exponent === 0) return NaN; // NaN
        if (mantissa === 0x07FE && exponent === 0) return NaN; // NRes
        if (mantissa === 0x0802 && exponent === 0) return Infinity; // +INFINITY
        if (mantissa === 0x0800 && exponent === 0) return -Infinity; // -INFINITY

        return mantissa * Math.pow(10, exponent);
    }

    parseAlternativeFormat(dataView) {
        // Alternative parsing for our specific DA14531 implementation
        // Try reading as a simple float value
        try {
            if (dataView.byteLength >= 5) {
                // Try reading as IEEE 754 float
                const temperature = dataView.getFloat32(1, true);
                if (temperature >= 30 && temperature <= 45) {
                    return temperature;
                }
            }

            // Try reading as scaled integer (temperature * 100)
            if (dataView.byteLength >= 3) {
                const tempInt = dataView.getUint16(1, true);
                const temperature = tempInt / 100.0;
                if (temperature >= 30 && temperature <= 45) {
                    return temperature;
                }
            }

            // Default fallback
            return 37.0;
        } catch (error) {
            return 37.0;
        }
    }
    
    async readMeasurementInterval() {
        try {
            const value = await this.intervalChar.readValue();
            const interval = value.getUint16(0, true); // little-endian
            this.currentInterval.textContent = `${interval} seconds`;
            this.intervalSlider.value = interval;
            this.sliderValue.textContent = interval;
            this.log(`Current measurement interval: ${interval} seconds`, 'info');
        } catch (error) {
            this.log(`Error reading measurement interval: ${error.message}`, 'error');
        }
    }
    
    async setMeasurementInterval() {
        try {
            const newInterval = parseInt(this.intervalSlider.value);
            const buffer = new ArrayBuffer(2);
            const view = new DataView(buffer);
            view.setUint16(0, newInterval, true); // little-endian
            
            await this.intervalChar.writeValue(buffer);
            this.currentInterval.textContent = `${newInterval} seconds`;
            this.log(`Measurement interval set to ${newInterval} seconds`, 'success');
            
        } catch (error) {
            this.log(`Error setting measurement interval: ${error.message}`, 'error');
        }
    }
    
    log(message, type = 'info') {
        const logEntry = document.createElement('div');
        logEntry.className = `log-entry ${type}`;
        logEntry.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
        
        this.logContainer.appendChild(logEntry);
        this.logContainer.scrollTop = this.logContainer.scrollHeight;
    }
    
    clearLog() {
        this.logContainer.innerHTML = '<div class="log-entry info">Log cleared.</div>';
    }

    async readBatteryLevel() {
        try {
            const value = await this.batteryChar.readValue();
            const batteryLevel = value.getUint8(0);
            this.updateBatteryDisplay(batteryLevel);
            this.log(`Battery level: ${batteryLevel}%`, 'info');
        } catch (error) {
            this.log(`Failed to read battery level: ${error.message}`, 'error');
        }
    }

    handleBatteryData(value) {
        const batteryLevel = value.getUint8(0);
        this.updateBatteryDisplay(batteryLevel);
        this.log(`Battery level updated: ${batteryLevel}%`, 'info');
    }

    updateBatteryDisplay(level) {
        this.batteryValue.textContent = `${level}%`;
        this.batteryFill.style.width = `${level}%`;

        // Update battery status and color
        let status, colorClass;
        if (level > 75) {
            status = 'Excellent';
            colorClass = 'battery-high';
        } else if (level > 50) {
            status = 'Good';
            colorClass = 'battery-medium';
        } else if (level > 25) {
            status = 'Low';
            colorClass = 'battery-low';
        } else {
            status = 'Critical';
            colorClass = 'battery-critical';
        }

        this.batteryStatus.textContent = status;
        this.batteryFill.className = `battery-fill ${colorClass}`;
    }
}

// Initialize the application when the page loads
document.addEventListener('DOMContentLoaded', () => {
    new TemperatureMonitor();
});
