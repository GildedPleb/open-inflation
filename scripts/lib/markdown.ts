export interface Heading {
  readonly level: number;
  readonly text: string;
  readonly line: number;
}
export function headings(_md: string): Heading[] {
  throw new Error("not implemented");
}
export function slugs(_md: string): Set<string> {
  throw new Error("not implemented");
}
export function links(_md: string): { target: string; line: number }[] {
  throw new Error("not implemented");
}
