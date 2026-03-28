/**
 * Sim Academy — shared type definitions.
 * Course content is file-based (lib/academy/content/); only certificates are DB-backed.
 */
import type { academyCertificate } from '@sim/db/schema'

export type LessonType = 'video' | 'exercise' | 'quiz' | 'mixed'

export interface Course {
  /** Stable ID — stored on certificates; never change after launch */
  id: string
  slug: string
  title: string
  description?: string
  imageUrl?: string
  estimatedMinutes?: number
  modules: Module[]
}

export interface Module {
  id: string
  title: string
  description?: string
  lessons: Lesson[]
}

export interface Lesson {
  /** Stable ID — stored in localStorage for completion tracking; never change after launch */
  id: string
  slug: string
  title: string
  description?: string
  lessonType: LessonType
  videoUrl?: string
  videoDurationSeconds?: number
  exerciseConfig?: ExerciseDefinition
  quizConfig?: QuizDefinition
}

export type AcademyCertStatus = 'active' | 'revoked' | 'expired'

export interface CertificateMetadata {
  /** Recipient name at time of issuance */
  recipientName: string
  /** Course title at time of issuance */
  courseTitle: string
}

/** Certificate record derived from the DB schema — metadata narrowed to its known shape. */
export type AcademyCertificate = Omit<typeof academyCertificate.$inferSelect, 'metadata'> & {
  metadata: CertificateMetadata | null
}

/**
 * Full configuration for an interactive canvas exercise.
 * Defined inline in each lesson file.
 */
export interface ExerciseDefinition {
  /** Instructions shown to the learner above the checklist */
  instructions: string
  /** Block type IDs available in the exercise toolbar */
  availableBlocks: string[]
  /** Blocks pre-placed on the canvas at exercise start */
  initialBlocks?: ExerciseBlockState[]
  /** Edges pre-placed on the canvas at exercise start */
  initialEdges?: ExerciseEdgeState[]
  /** Rules the learner must satisfy to complete the exercise */
  validationRules: ValidationRule[]
  /** Progressive hints shown one-at-a-time if the user gets stuck */
  hints?: string[]
  /**
   * Mock outputs displayed per block when the user clicks "Run".
   * Keyed by block ID (for initial blocks) or block type (for dynamically added blocks).
   */
  mockOutputs?: Record<string, MockBlockOutput>
}

export interface ExerciseBlockState {
  id: string
  /** Block type from the block registry (e.g. 'agent', 'function', 'starter') */
  type: string
  position: { x: number; y: number }
  /** Pre-filled sub-block values — keyed by sub-block ID */
  subBlocks?: Record<string, unknown>
  /** If true, the block cannot be moved or deleted by the learner */
  locked?: boolean
}

export interface ExerciseEdgeState {
  id: string
  source: string
  target: string
  sourceHandle?: string
  targetHandle?: string
}

export interface MockBlockOutput {
  response: Record<string, unknown>
  delay?: number
}

export type ValidationRule = { label?: string } & (
  | { type: 'block_exists'; blockType: string; count?: number }
  | {
      type: 'block_configured'
      blockType: string
      subBlockId: string
      valueNotEmpty?: boolean
      valuePattern?: string
    }
  | { type: 'edge_exists'; sourceType: string; targetType: string; sourceHandle?: string }
  | { type: 'block_count_min'; count: number }
  | { type: 'block_count_max'; count: number }
  | { type: 'custom'; validatorId: string; params?: Record<string, unknown> }
)

export interface ValidationRuleResult {
  rule: ValidationRule
  passed: boolean
  message: string
}

export interface ValidationResult {
  passed: boolean
  results: ValidationRuleResult[]
}

/** Full configuration for a quiz. Defined inline in each lesson file. */
export interface QuizDefinition {
  /** Minimum score (0-100) required to pass */
  passingScore: number
  questions: QuizQuestion[]
}

export type QuizQuestion =
  | {
      type: 'multiple_choice'
      question: string
      options: string[]
      correctIndex: number
      explanation?: string
    }
  | {
      type: 'multi_select'
      question: string
      options: string[]
      correctIndices: number[]
      explanation?: string
    }
  | {
      type: 'true_false'
      question: string
      correctAnswer: boolean
      explanation?: string
    }
