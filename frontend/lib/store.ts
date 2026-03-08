/**
 * Zustand client state management
 * - Independent column selection state for each of the 4 plots
 * - Date range filter (DateRangePicker ↔ Plotly X-axis synchronization)
 * - Active Celery task ID management
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
  /** Selected column state for each of the 4 plots */
  plots: [PlotState, PlotState, PlotState, PlotState];
  /** Date range filter (bidirectional sync between Plotly zoom and DateRangePicker) */
  dateRange: DateRange;

  /** Replace all selected columns for a specific plot */
  setPlotColumns: (plotIndex: 0 | 1 | 2 | 3, columns: ColumnKey[]) => void;
  /** Toggle a single column in a specific plot (minimum 1 column maintained) */
  togglePlotColumn: (plotIndex: 0 | 1 | 2 | 3, column: ColumnKey) => void;
  /** Set the date range */
  setDateRange: (start: string | null, end: string | null) => void;
}

export const useChartStore = create<ChartStore>((set) => ({
  // Default column configuration for each of the 4 plots
  plots: [
    { selectedColumns: ["vfd_freq", "choke"] },          // Plot 1: Control system
    { selectedColumns: ["motor_current", "motor_temp"] }, // Plot 2: Electrical system
    { selectedColumns: ["pi", "pd"] },                    // Plot 3: Pressure system
    { selectedColumns: ["motor_vib", "water_cut"] },      // Plot 4: Vibration/Production
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

      // Maintain minimum 1 selected column
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

// ============================================================
// Analysis task state store
// ============================================================

/**
 * Store for managing Celery async task IDs.
 * Stores the active task_id for each (wellId, step) combination so that
 * polling state is preserved across page navigation.
 */
interface AnalysisStore {
  /** Key: '{wellId}_step{N}', Value: Celery task_id */
  activeTaskIds: Record<string, string>;

  /** Save task_id for a specific well's step */
  setTaskId: (wellId: string, step: number, taskId: string) => void;
  /** Remove task_id for a specific well's step (on completion or cancellation) */
  clearTaskId: (wellId: string, step: number) => void;
  /** Retrieve task_id for a specific well's step */
  getTaskId: (wellId: string, step: number) => string | undefined;
}

export const useAnalysisStore = create<AnalysisStore>((set, get) => ({
  activeTaskIds: {},

  setTaskId: (wellId, step, taskId) =>
    set((state) => ({
      activeTaskIds: {
        ...state.activeTaskIds,
        [`${wellId}_step${step}`]: taskId,
      },
    })),

  clearTaskId: (wellId, step) =>
    set((state) => {
      const next = { ...state.activeTaskIds };
      delete next[`${wellId}_step${step}`];
      return { activeTaskIds: next };
    }),

  getTaskId: (wellId, step) =>
    get().activeTaskIds[`${wellId}_step${step}`],
}));
