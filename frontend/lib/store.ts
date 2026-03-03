/**
 * Zustand 클라이언트 상태 관리
 * - 4개 Plot의 독립적인 컬럼 선택 상태
 * - 날짜 범위 필터 (DateRangePicker ↔ Plotly X축 동기화)
 */
import { create } from "zustand";

export type ColumnKey =
  | "choke" | "whp" | "flt" | "casing_pressure" | "casing_pressure_2"
  | "vfd_freq" | "motor_volts" | "motor_current" | "motor_power"
  | "motor_temp" | "motor_vib" | "current_leak"
  | "pi" | "ti" | "pd" | "static_pressure" | "dd"
  | "water_cut" | "emulsion" | "bsw"
  | "mfm_pressure" | "mfm_temp"
  | "liquid_rate" | "water_rate" | "oil_haimo" | "gas_meter" | "gor"
  | "dp_cross_pump" | "liquid_pi" | "oil_pi";

export interface PlotState {
  selectedColumns: ColumnKey[];
}

export interface DateRange {
  start: string | null;
  end: string | null;
}

interface ChartStore {
  /** 4개 Plot 각각의 선택 컬럼 상태 */
  plots: [PlotState, PlotState, PlotState, PlotState];
  /** 날짜 범위 필터 (Plotly 줌과 DateRangePicker 양방향 동기화) */
  dateRange: DateRange;

  /** 특정 Plot의 선택 컬럼 전체 교체 */
  setPlotColumns: (plotIndex: 0 | 1 | 2 | 3, columns: ColumnKey[]) => void;
  /** 특정 Plot에서 단일 컬럼 토글 (최소 1개 유지) */
  togglePlotColumn: (plotIndex: 0 | 1 | 2 | 3, column: ColumnKey) => void;
  /** 날짜 범위 설정 */
  setDateRange: (start: string | null, end: string | null) => void;
}

export const useChartStore = create<ChartStore>((set) => ({
  // 4개 Plot 기본 컬럼 설정
  plots: [
    { selectedColumns: ["vfd_freq", "choke"] },          // Plot 1: 제어계통
    { selectedColumns: ["motor_current", "motor_temp"] }, // Plot 2: 전기계통
    { selectedColumns: ["pi", "pd"] },                    // Plot 3: 압력계통
    { selectedColumns: ["motor_vib", "water_cut"] },      // Plot 4: 진동/생산
  ],
  dateRange: { start: null, end: null },

  setPlotColumns: (plotIndex, columns) =>
    set((state) => {
      const newPlots = [...state.plots] as [PlotState, PlotState, PlotState, PlotState];
      newPlots[plotIndex] = { selectedColumns: columns };
      return { plots: newPlots };
    }),

  togglePlotColumn: (plotIndex, column) =>
    set((state) => {
      const newPlots = [...state.plots] as [PlotState, PlotState, PlotState, PlotState];
      const current = newPlots[plotIndex].selectedColumns;
      const isSelected = current.includes(column);

      // 최소 1개 선택 유지
      if (isSelected && current.length === 1) return state;

      newPlots[plotIndex] = {
        selectedColumns: isSelected
          ? current.filter((c) => c !== column)
          : [...current, column],
      };
      return { plots: newPlots };
    }),

  setDateRange: (start, end) => set({ dateRange: { start, end } }),
}));
