/** Grade bands from the scoring proposal. Lower bound inclusive. Draft, not locked. */
export const GRADE_BANDS = [
  { min: 97, grade: "A+" },
  { min: 93, grade: "A" },
  { min: 90, grade: "A-" },
  { min: 87, grade: "B+" },
  { min: 83, grade: "B" },
  { min: 80, grade: "B-" },
  { min: 77, grade: "C+" },
  { min: 73, grade: "C" },
  { min: 70, grade: "C-" },
  { min: 60, grade: "D" },
  { min: -Infinity, grade: "F" },
] as const;

export type Grade = (typeof GRADE_BANDS)[number]["grade"];

export function gradeFor(score: number): Grade {
  for (const band of GRADE_BANDS) {
    if (score >= band.min) return band.grade;
  }
  return "F";
}
