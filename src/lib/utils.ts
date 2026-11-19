export type ClassValue = string | number | boolean | null | undefined | ClassValue[];

export function cn(...inputs: ClassValue[]): string {
  const classes: string[] = [];
  const push = (val: ClassValue): void => {
    if (!val) return;
    if (typeof val === 'string' || typeof val === 'number') {
      classes.push(String(val));
    } else if (Array.isArray(val)) {
      for (const item of val) push(item);
    }
  };
  for (const input of inputs) push(input);
  return classes.join(' ');
}
