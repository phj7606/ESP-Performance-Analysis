/**
 * 차트 컬럼 메타데이터 설정
 * 각 센서 변수의 라벨, 단위, 색상, Y축 위치를 정의
 */
import type { ColumnKey } from "@/lib/store";

export interface ColumnMeta {
  label: string;
  unit: string;
  group: string;
  color: string;
  /** y: 왼쪽 Y축, y2: 오른쪽 Y축 */
  yaxis: "y" | "y2";
}

export const COLUMN_CONFIG: Record<ColumnKey, ColumnMeta> = {
  // 제어계통
  vfd_freq:        { label: "VFD Freq",        unit: "Hz",      group: "제어계통", color: "#2563eb", yaxis: "y" },
  choke:           { label: "Choke",            unit: "1/128",   group: "제어계통", color: "#7c3aed", yaxis: "y2" },

  // 전기계통
  motor_current:   { label: "Motor Current",   unit: "A",       group: "전기계통", color: "#dc2626", yaxis: "y" },
  motor_temp:      { label: "Motor Temp",       unit: "℃",      group: "전기계통", color: "#f59e0b", yaxis: "y2" },
  motor_volts:     { label: "Motor Volts",      unit: "V",       group: "전기계통", color: "#10b981", yaxis: "y2" },
  motor_power:     { label: "Motor Power",      unit: "kW",      group: "전기계통", color: "#06b6d4", yaxis: "y2" },
  motor_vib:       { label: "Motor Vib",        unit: "0.001g",  group: "전기계통", color: "#f97316", yaxis: "y" },
  current_leak:    { label: "Current Leak",     unit: "uA",      group: "전기계통", color: "#84cc16", yaxis: "y2" },

  // 압력계통
  pi:              { label: "Pi (흡입압)",      unit: "PSI",     group: "압력계통", color: "#3b82f6", yaxis: "y" },
  pd:              { label: "Pd (토출압)",      unit: "PSI",     group: "압력계통", color: "#ef4444", yaxis: "y2" },
  whp:             { label: "WHP",              unit: "PSI",     group: "압력계통", color: "#8b5cf6", yaxis: "y2" },
  dd:              { label: "DD",               unit: "PSI",     group: "압력계통", color: "#0ea5e9", yaxis: "y2" },
  static_pressure: { label: "Static Pressure", unit: "PSI",     group: "압력계통", color: "#6366f1", yaxis: "y2" },
  casing_pressure: { label: "Casing P (9-5/8)",unit: "PSI",     group: "압력계통", color: "#14b8a6", yaxis: "y2" },
  casing_pressure_2: { label: "Casing P (13-3/8)", unit: "PSI", group: "압력계통", color: "#a3e635", yaxis: "y2" },

  // 온도계통
  ti:              { label: "Ti (흡입온도)",    unit: "℃",      group: "온도계통", color: "#f43f5e", yaxis: "y" },
  flt:             { label: "FLT",              unit: "℃",      group: "온도계통", color: "#fb923c", yaxis: "y2" },
  mfm_temp:        { label: "MFM Temp",         unit: "℃",      group: "온도계통", color: "#fbbf24", yaxis: "y2" },

  // 생산량
  liquid_rate:     { label: "Liquid Rate",      unit: "Sm³/d",  group: "생산량",   color: "#22c55e", yaxis: "y" },
  water_rate:      { label: "Water Rate",       unit: "Sm³/d",  group: "생산량",   color: "#60a5fa", yaxis: "y2" },
  oil_haimo:       { label: "Oil (Haimo)",      unit: "Sm³/d",  group: "생산량",   color: "#fbbf24", yaxis: "y2" },
  gas_meter:       { label: "Gas",              unit: "Sm³/d",  group: "생산량",   color: "#a78bfa", yaxis: "y2" },
  gor:             { label: "GOR",              unit: "Sm³/Sm³",group: "생산량",   color: "#fb7185", yaxis: "y2" },
  water_cut:       { label: "Water Cut",        unit: "%",      group: "생산량",   color: "#38bdf8", yaxis: "y2" },

  // 기타
  emulsion:        { label: "Emulsion",         unit: "%",      group: "기타",     color: "#a3a3a3", yaxis: "y2" },
  bsw:             { label: "BS&W",             unit: "%",      group: "기타",     color: "#d4d4d4", yaxis: "y2" },
  mfm_pressure:    { label: "MFM Pressure",     unit: "kPa",    group: "기타",     color: "#94a3b8", yaxis: "y2" },
  dp_cross_pump:   { label: "DP Cross Pump",    unit: "PSI",    group: "기타",     color: "#c084fc", yaxis: "y2" },
  liquid_pi:       { label: "Liquid PI",        unit: "",       group: "기타",     color: "#34d399", yaxis: "y2" },
  oil_pi:          { label: "Oil PI",           unit: "",       group: "기타",     color: "#fde68a", yaxis: "y2" },
};

/** 드롭다운 선택을 위한 그룹별 컬럼 목록 */
export const COLUMN_GROUPS: Record<string, ColumnKey[]> = {
  "제어계통":  ["vfd_freq", "choke"],
  "전기계통":  ["motor_current", "motor_temp", "motor_volts", "motor_power", "motor_vib", "current_leak"],
  "압력계통":  ["pi", "pd", "whp", "dd", "static_pressure", "casing_pressure", "casing_pressure_2"],
  "온도계통":  ["ti", "flt", "mfm_temp"],
  "생산량":    ["liquid_rate", "water_rate", "oil_haimo", "gas_meter", "gor", "water_cut"],
  "기타":      ["emulsion", "bsw", "mfm_pressure", "dp_cross_pump", "liquid_pi", "oil_pi"],
};
