/** Public API of the SpEL core — framework-free, usable from React, RHF/zod, or a Node script. */
export { analyzeTemplate, expressionAt, validateTemplate } from './analyze';
export type { AnalyzedExpression, AnalyzedSegment, TemplateAnalysis, ValidationResult } from './analyze';
export { completeExpression } from './completion';
export type { CompletionOption, CompletionResult } from './completion';
export { evaluate } from './evaluator';
export type { EvalEnv, EvalOutcome } from './evaluator';
export { explainExpression } from './explain';
export type { ExplainNode, ExplainState } from './explain';
export { renderTemplate } from './render';
export type { RenderEnv, RenderPart, RenderResult, RenderStatus } from './render';
export { describeType, EMPTY_SCHEMA, t } from './schema';
export type { FunctionDef, ObjectTypeDef, PropertyDef, SpelType, TemplateSchema } from './schema';
export type { Severity, SpelDiagnostic, SpelRecord, SpelValue } from './types';
export { formatForInspector } from './values';
