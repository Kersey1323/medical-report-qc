import * as SelectPrimitive from '@radix-ui/react-select';
import {Check,ChevronDown,ChevronUp} from 'lucide-react';

interface SelectProps {
 id?:string;
 'aria-label'?:string;
 value:string;
 onChange:(value:string)=>void;
 options:Array<{value:string;label:string}>;
 disabled?:boolean;
 compact?:boolean;
}

/** Shared accessible select; encoded values also support an empty mapping/filter. */
export function Select({id,'aria-label':ariaLabel,value,onChange,options,disabled=false,compact=false}:SelectProps){
 return <SelectPrimitive.Root value={`option:${value}`} onValueChange={next=>onChange(next.slice(7))} disabled={disabled}>
  <SelectPrimitive.Trigger id={id} aria-label={ariaLabel} className={`select-trigger${compact?' select-compact':''}`}>
   <SelectPrimitive.Value/>
   <SelectPrimitive.Icon asChild><ChevronDown size={16} aria-hidden="true"/></SelectPrimitive.Icon>
  </SelectPrimitive.Trigger>
  <SelectPrimitive.Portal>
   <SelectPrimitive.Content className="select-content" position="popper" sideOffset={6} collisionPadding={12} onEscapeKeyDown={event=>event.stopPropagation()}>
    <SelectPrimitive.ScrollUpButton className="select-scroll"><ChevronUp size={14}/></SelectPrimitive.ScrollUpButton>
    <SelectPrimitive.Viewport className="select-viewport">
     {options.map(option=><SelectPrimitive.Item key={option.value} value={`option:${option.value}`} className="select-option">
      <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
      <SelectPrimitive.ItemIndicator className="select-indicator"><Check size={15} aria-hidden="true"/></SelectPrimitive.ItemIndicator>
     </SelectPrimitive.Item>)}
    </SelectPrimitive.Viewport>
    <SelectPrimitive.ScrollDownButton className="select-scroll"><ChevronDown size={14}/></SelectPrimitive.ScrollDownButton>
   </SelectPrimitive.Content>
  </SelectPrimitive.Portal>
 </SelectPrimitive.Root>;
}
