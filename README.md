# 🌱 AquaSystem – Smart Automated Aquaponics Dashboard

A modern web-based monitoring and control platform developed for the **Smart Automated Aquaponic System** graduation project at **Minia University**.

The dashboard provides real-time monitoring, intelligent control, historical analysis, alarm management, and user access control for an IoT-based aquaponics system powered by ESP32.

---

## 📌 Project Overview

AquaSystem is designed to simplify the operation of an automated aquaponics system by providing a centralized interface for monitoring environmental conditions and controlling system actuators.

The platform communicates with the backend API over Wi-Fi, while the ESP32 continuously sends sensor readings and receives control commands.

The website supports two user roles:

- **Administrator**
  - Full monitoring and control
  - Modify automation settings
  - Control actuators
  - Manage users
  - Configure sensor ranges
  - Access historical reports

- **Viewer**
  - Read-only access
  - View dashboards
  - Monitor sensors
  - View historical data
  - Cannot modify system settings

---

# ✨ Features

## 📊 Real-Time Dashboard

The dashboard provides a complete overview of the system including:

- Water pH
- Water Temperature
- TDS
- Turbidity
- Air Temperature
- Humidity
- Water Levels
- Active Actuators
- ESP32 Status
- ESP32-CAM Status
- Historical Trend Charts

---

## 🐟 Fish Tank Monitoring

Monitor the primary aquaculture unit through:

- Water Level
- Water Temperature
- pH
- TDS
- Turbidity
- Float Switch Status
- Environmental Temperature
- Environmental Humidity

Includes historical charts for sensor values.

---

## 💧 Filtration Tank Monitoring

Displays:

- Filter Tank Water Level
- Water Temperature
- Flow Rate (Fish → Filter)
- Flow Rate (Filter → Hydroponics)
- Float Switch Status
- Filter Pump Status
- Dosing Pump Status

---

## 🌿 Hydroponic Monitoring

Monitor the hydroponic growing section including:

- Water level
- Environmental conditions
- Flow status
- Pump operation
- Plant growing conditions

---

## 🚰 Supply & Drain Tank Monitoring

Dedicated pages display:

- Water Levels
- Pump Status
- Valve Status
- Tank Condition

---

# ⚙️ Actuator Control

Administrators can manually control system components including:

- Main Water Pump
- Filter Pump
- Aerator
- Heater
- Acid Dosing Pump
- Base Dosing Pump
- Nutrient Pump
- Solenoid Valves
- Alarm Buzzer
- Alarm LED

Supports:

- ON/OFF Control
- PWM Speed Control (Main Pump)

---

# 📈 Sensor Management

The Sensor Management page provides:

- Current Sensor Values
- Sensor Type
- Tank Assignment
- Normal Operating Range
- Sensor Health
- Calibration Status
- Last Calibration Date

Administrators can:

- Update normal operating ranges
- Calibrate supported sensors

---

# 🚨 Alarm System

The website automatically detects abnormal conditions.

Alerts appear immediately after login whenever sensor readings exceed configured limits.

Alarm notifications include:

- Sensor name
- Current value
- Normal range
- Alert type
- Acknowledge button

This enables quick response before problems affect fish or plants.

---

# 📂 Historical Data

The platform stores sensor readings for later analysis.

Users can:

- Browse historical records
- View timestamped sensor logs
- Analyze previous measurements
- Export data as CSV (Excel compatible)

---

# 📷 ESP32-CAM Monitoring

The ESP32-CAM is used for monitoring plant growth.

Features include:

- Capture plant images
- Image history
- Timelapse viewer
- Growth documentation

This allows users to visually monitor crop development over time.

---

# 🌱 Plants & Fish Reference

A built-in reference page provides suitable species for aquaponics.

For each plant and fish, the system displays:

- Optimal pH
- Recommended Temperature
- Recommended TDS
- Current System Values
- Compatibility Status

This helps users select species that match current water conditions.

---

# 👤 User Authentication

Secure authentication system supporting:

- Login
- Registration
- Role-based Access

Roles:

- Administrator
- Viewer

Permissions are enforced throughout the website.

---

# 📡 System Communication

The website communicates with the backend API through Wi-Fi.

Communication flow:

```
ESP32
   │
Wi-Fi
   │
Backend API
   │
Website Dashboard
```

The ESP32 operates as an API client, periodically sending sensor readings and receiving actuator commands.

---

# 🛠 Technologies Used

### Frontend

- HTML5
- CSS3
- JavaScript

### Backend

- REST API

### Embedded System

- ESP32-WROOM-32
- ESP32-CAM

### Communication

- Wi-Fi
- HTTP API

---

# 📦 Main Sensors

- DS18B20 Water Temperature
- Analog pH Sensor
- TDS Sensor
- Turbidity Sensor
- SHT31 Temperature & Humidity
- Water Level Sensors
- Float Switches
- YF-S201 Flow Sensors

---

# ⚡ Controlled Devices

- Main Pump
- Filter Pump
- Aerator
- Heater
- Dosing Pumps
- Solenoid Valves
- Alarm Buzzer
- Alarm LED

---

# 🎯 Project Goals

- Automate aquaponic operation
- Reduce manual intervention
- Improve water quality monitoring
- Protect fish and plants
- Provide remote monitoring
- Enable intelligent control
- Store historical operational data

---

# 👨‍🎓 Graduation Project

**Smart Automated Aquaponic System**

Faculty of Engineering  
Minia University  
Department of Mechatronics Engineering

---

## 📄 License

This project was developed as part of an undergraduate graduation project for educational purposes.
