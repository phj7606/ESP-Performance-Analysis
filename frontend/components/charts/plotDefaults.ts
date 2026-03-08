/**
 * Default configuration for the 4 plots
 */
import type { ColumnKey } from "@/lib/store";

export interface PlotDefault {
  title: string;
  description: string;
  defaultColumns: ColumnKey[];
}

/** Default settings for the 4 plots (indices 0–3) */
export const PLOT_DEFAULTS: PlotDefault[] = [
  {
    title: "Control",
    description: "ESP operating frequency and choke opening",
    defaultColumns: ["vfd_freq", "choke"],
  },
  {
    title: "Electrical",
    description: "Motor current and temperature (load state)",
    defaultColumns: ["motor_current", "motor_temp"],
  },
  {
    title: "Pressure",
    description: "Intake Pressure (Pi) vs Discharge Pressure (Pd)",
    defaultColumns: ["pi", "pd"],
  },
  {
    title: "Vibration / Production",
    description: "Mechanical vibration and water cut",
    defaultColumns: ["motor_vib", "water_cut"],
  },
];
