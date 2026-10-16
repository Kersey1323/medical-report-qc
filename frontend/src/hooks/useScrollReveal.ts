import {useLayoutEffect,type RefObject} from 'react';

/** One-time reveals, including the first viewport; no IO means visible content. */
export function useScrollReveal(root:RefObject<HTMLDivElement|null>){
 useLayoutEffect(()=>{
  const container=root.current;
  if(!container||!('IntersectionObserver' in window))return;
  const elements=Array.from(container.querySelectorAll<HTMLElement>('[data-reveal]'));
  const motion=window.matchMedia('(prefers-reduced-motion: reduce)');
  const revealed=new Set<Element>();
  let observer:IntersectionObserver|undefined;
  let frame=0;
  const stop=()=>{observer?.disconnect();cancelAnimationFrame(frame)};
  const configure=()=>{
   stop();
   if(motion.matches){
    elements.forEach(el=>{revealed.add(el);delete el.dataset.revealState});
    return;
   }
   elements.forEach(el=>{el.dataset.revealState=revealed.has(el)?'visible':'hidden'});
   observer=new IntersectionObserver(entries=>{
    for(const entry of entries){
     if(!entry.isIntersecting||entry.intersectionRatio<.15)continue;
     (entry.target as HTMLElement).dataset.revealState='visible';
     revealed.add(entry.target);
     observer?.unobserve(entry.target);
    }
   },{root:container,rootMargin:'-84px 0px 0px 0px',threshold:.15});
   // Paint the hidden starting state before observing: the initial hero must
   // transition too, rather than appearing fully visible on the first frame.
   frame=requestAnimationFrame(()=>{
    frame=requestAnimationFrame(()=>{
     elements.filter(el=>!revealed.has(el)).forEach(el=>observer?.observe(el));
    });
   });
  };
  configure();motion.addEventListener('change',configure);
  return()=>{stop();motion.removeEventListener('change',configure);elements.forEach(el=>delete el.dataset.revealState)};
 },[root]);
}
