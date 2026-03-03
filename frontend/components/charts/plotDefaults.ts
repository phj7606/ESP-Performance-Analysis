/**
 * 4개 Plot의 기본 설정값 정의
 */
import type { ColumnKey } from "@/lib/store";

export interface PlotDefault {
  title: string;
  description: string;
  defaultColumns: ColumnKey[];
}

/** 4개 Plot 기본 설정 (인덱스 0~3) */
export const PLOT_DEFAULTS: PlotDefault[] = [
  {
    title: "제어계통",
    description: "ESP 운전 주파수 및 Choke 개도",
    defaultColumns: ["vfd_freq", "choke"],
  },
  {
    title: "전기계통",
    description: "모터 전류 및 온도 (부하 상태)",
    defaultColumns: ["motor_current", "motor_temp"],
  },
  {
    title: "압력계통",
    description: "흡입압(Pi) vs 토출압(Pd)",
    defaultColumns: ["pi", "pd"],
  },
  {
    title: "진동/생산",
    description: "기계 진동 및 수분 함량",
    defaultColumns: ["motor_vib", "water_cut"],
  },
];
