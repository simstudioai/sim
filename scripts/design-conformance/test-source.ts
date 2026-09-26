/** Small source-owned test system. Tests exercise extraction, never a registry mock. */
export const testComponents: Record<string, string> = {
  'packages/emcn/src/index.ts': "export * from './components/test-controls'",
  'packages/emcn/src/components/test-controls.tsx': `
import type {HTMLAttributes, ButtonHTMLAttributes, InputHTMLAttributes, ComponentType} from 'react'
declare function cn(...args:unknown[]):string
export function Button({className,...props}:ButtonHTMLAttributes<HTMLButtonElement>){return <button {...props} className={cn('h-8 rounded-lg bg-[var(--ink)] px-2 text-small',className)}/>}
/** @designAllow inputClassName * */
export function ChipInput({className,inputClassName,icon:Icon,...props}:InputHTMLAttributes<HTMLInputElement>&{inputClassName?:string;icon?:ComponentType<{className?:string}>}){return <div className={cn('h-8 rounded-lg gap-2 px-2 bg-[var(--ink)]',className)}>{Icon&&<Icon className='size-3'/>}<input {...props} className={cn('text-small',inputClassName)}/></div>}
export function ChipTextarea({className,...props}:HTMLAttributes<HTMLTextAreaElement>){return <textarea {...props} className={cn('rounded-lg px-2 bg-[var(--ink)]',className)}/>}
export function ChipModal({className,children,...props}:HTMLAttributes<HTMLDivElement>){return <div {...props} className={cn('h-40 p-2 rounded-lg',className)}>{children}</div>}
export function ChipModalBody({className,children,...props}:HTMLAttributes<HTMLDivElement>){return <div {...props} className={cn('p-2 gap-2',className)}>{children}</div>}
/**
 * @designProtect className *
 * @designProtect style *
 */
export function ChipModalField({className,...props}:HTMLAttributes<HTMLDivElement>){return <div {...props} className={cn('flex flex-col gap-2 p-2',className)}/>}
export function Label({className,...props}:HTMLAttributes<HTMLLabelElement>){return <label {...props} className={cn('text-small',className)}/>}
`,
}
