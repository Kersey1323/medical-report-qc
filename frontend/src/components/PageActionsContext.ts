import {createContext} from 'react';

// Undefined supports standalone pages; null means the shell slot is mounting.
export const PageActionsContext=createContext<HTMLElement|null|undefined>(undefined);
