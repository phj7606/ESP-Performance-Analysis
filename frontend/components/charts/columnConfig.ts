/**
 * Chart column metadata configuration
 * Defines the label, unit, color, and Y-axis position for each sensor variable
 */
import type { ColumnKey } from "@/lib/store";

export interface ColumnMeta {
  label: string;
  unit: string;
  group: string;
  color: string;
  /** y: left Y-axis, y2: right Y-axis */
  yaxis: "y" | "y2";
}

export const COLUMN_CONFIG: Record<ColumnKey, ColumnMeta> = {
  // Control system
  vfd_freq:        { label: "VFD Freq",           unit: "Hz",      group: "Control",     color: "#2563eb", yaxis: "y" },
  choke:           { label: "Choke",               unit: "1/128",   group: "Control",     color: "#7c3aed", yaxis: "y2" },

  // Electrical system
  motor_current:   { label: "Motor Current",       unit: "A",       group: "Electrical",  color: "#dc2626", yaxis: "y" },
  motor_temp:      { label: "Motor Temperature",   unit: "\u2103",  group: "Electrical",  color: "#f59e0b", yaxis: "y2" },
  motor_volts:     { label: "Motor Volts",         unit: "V",       group: "Electrical",  color: "#10b981", yaxis: "y2" },
  motor_power:     { label: "Motor Power",         unit: "kW",      group: "Electrical",  color: "#06b6d4", yaxis: "y2" },
  motor_vib:       { label: "Motor Vibration",     unit: "0.001g",  group: "Electrical",  color: "#f97316", yaxis: "y" },
  current_leak:    { label: "Current Leak",        unit: "uA",      group: "Electrical",  color: "#84cc16", yaxis: "y2" },

  // Pressure system
  pi:              { label: "Pi (Intake Pressure)",    unit: "PSI",     group: "Pressure",    color: "#3b82f6", yaxis: "y" },
  pd:              { label: "Pd (Discharge Pressure)", unit: "PSI",     group: "Pressure",    color: "#ef4444", yaxis: "y2" },
  whp:             { label: "WHP",                 unit: "PSI",     group: "Pressure",    color: "#8b5cf6", yaxis: "y2" },
  dd:              { label: "DD",                  unit: "PSI",     group: "Pressure",    color: "#0ea5e9", yaxis: "y2" },
  static_pressure: { label: "Static Pressure",     unit: "PSI",     group: "Pressure",    color: "#6366f1", yaxis: "y2" },
  casing_pressure: { label: "Casing P (9-5/8)",    unit: "PSI",     group: "Pressure",    color: "#14b8a6", yaxis: "y2" },
  casing_pressure_2: { label: "Casing P (13-3/8)", unit: "PSI",     group: "Pressure",    color: "#a3e635", yaxis: "y2" },

  // Temperature system
  ti:              { label: "Ti (Intake Temp)",    unit: "\u2103",  group: "Temperature", color: "#f43f5e", yaxis: "y" },
  flt:             { label: "FLT",                 unit: "\u2103",  group: "Temperature", color: "#fb923c", yaxis: "y2" },
  mfm_temp:        { label: "MFM Temp",            unit: "\u2103",  group: "Temperature", color: "#fbbf24", yaxis: "y2" },

  // Production
  liquid_rate:     { label: "Liquid Rate",         unit: "Sm\u00b3/d",  group: "Production",  color: "#22c55e", yaxis: "y" },
  water_rate:      { label: "Water Rate",          unit: "Sm\u00b3/d",  group: "Production",  color: "#60a5fa", yaxis: "y2" },
  oil_haimo:       { label: "Oil (Haimo)",         unit: "Sm\u00b3/d",  group: "Production",  color: "#fbbf24", yaxis: "y2" },
  gas_meter:       { label: "Gas",                 unit: "Sm\u00b3/d",  group: "Production",  color: "#a78bfa", yaxis: "y2" },
  gor:             { label: "GOR",                 unit: "Sm\u00b3/Sm\u00b3", group: "Production", color: "#fb7185", yaxis: "y2" },
  water_cut:       { label: "Water Cut",           unit: "%",       group: "Production",  color: "#38bdf8", yaxis: "y2" },

  // Other
  emulsion:        { label: "Emulsion",            unit: "%",       group: "Other",       color: "#a3a3a3", yaxis: "y2" },
  bsw:             { label: "BS&W",                unit: "%",       group: "Other",       color: "#d4d4d4", yaxis: "y2" },
  mfm_pressure:    { label: "MFM Pressure",        unit: "kPa",     group: "Other",       color: "#94a3b8", yaxis: "y2" },
  dp_cross_pump:   { label: "DP Cross Pump",       unit: "PSI",     group: "Other",       color: "#c084fc", yaxis: "y2" },
  liquid_pi:       { label: "Liquid PI",           unit: "",        group: "Other",       color: "#34d399", yaxis: "y2" },
  oil_pi:          { label: "Oil PI",              unit: "",        group: "Other",       color: "#fde68a", yaxis: "y2" },
};

/** Column list grouped by category for the dropdown selector */
export const COLUMN_GROUPS: Record<string, ColumnKey[]> = {
  "Control":     ["vfd_freq", "choke"],
  "Electrical":  ["motor_current", "motor_temp", "motor_volts", "motor_power", "motor_vib", "current_leak"],
  "Pressure":    ["pi", "pd", "whp", "dd", "static_pressure", "casing_pressure", "casing_pressure_2"],
  "Temperature": ["ti", "flt", "mfm_temp"],
  "Production":  ["liquid_rate", "water_rate", "oil_haimo", "gas_meter", "gor", "water_cut"],
  "Other":       ["emulsion", "bsw", "mfm_pressure", "dp_cross_pump", "liquid_pi", "oil_pi"],
};
