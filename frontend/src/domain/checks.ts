import type {CheckKey} from '../api/types';
export const checks:Array<{key:CheckKey;name:string;short:string;description:string}>=[{key:'diagnosis',name:'诊断一致性质控',short:'诊断',description:'原描述、医生诊断与参考诊断比较'},{key:'csc',name:'字符纠错',short:'字符',description:'全文128字分块与原文位置对齐'},{key:'cgec',name:'语法纠错',short:'语法',description:'RAG教师与本地学生独立建议'},{key:'rag',name:'检索增强定位',short:'检索',description:'Top10表达证据与条件复核'}];
export const allChecks:CheckKey[]=checks.map(c=>c.key);
export const statusNames:Record<string,string>={pending:'待启动',running:'运行中',succeeded:'已完成',completed:'已完成',partial:'部分完成',failed:'执行失败',cancelled:'已取消',ready:'就绪',no_issue:'未发现异常',issue:'发现异常',needs_review:'需复核',unknown:'未确定',normal:'未发现异常',complete:'完整',invalid:'无效行'};
export const label=(value:string)=>statusNames[value]||value;
