import type {
  ExerciseBlockState,
  ExerciseEdgeState,
  ValidationResult,
  ValidationRule,
  ValidationRuleResult,
} from '@/lib/academy/types'

/**
 * Validates a learner's exercise canvas state against a set of rules.
 * Runs identically on the client (real-time feedback) and server (progress recording).
 */
export function validateExercise(
  blocks: ExerciseBlockState[],
  edges: ExerciseEdgeState[],
  rules: ValidationRule[]
): ValidationResult {
  const blockMap = new Map(blocks.map((b) => [b.id, b]))

  const results = rules.map((rule) => {
    const passed = checkRule(rule, blocks, edges, blockMap)
    return {
      rule,
      passed,
      message: getRuleMessage(rule, passed),
    } satisfies ValidationRuleResult
  })

  return {
    passed: results.every((r) => r.passed),
    results,
  }
}

function checkRule(
  rule: ValidationRule,
  blocks: ExerciseBlockState[],
  edges: ExerciseEdgeState[],
  blockMap: Map<string, ExerciseBlockState>
): boolean {
  switch (rule.type) {
    case 'block_exists': {
      const matches = blocks.filter((b) => b.type === rule.blockType)
      return matches.length >= (rule.count ?? 1)
    }

    case 'block_configured': {
      return blocks.some((b) => {
        if (b.type !== rule.blockType) return false
        const value = b.subBlocks?.[rule.subBlockId]
        if (rule.valueNotEmpty && (value === undefined || value === null || value === ''))
          return false
        if (rule.valuePattern && !new RegExp(rule.valuePattern).test(String(value ?? '')))
          return false
        return true
      })
    }

    case 'edge_exists': {
      return edges.some((e) => {
        const source = blockMap.get(e.source)
        const target = blockMap.get(e.target)
        return source?.type === rule.sourceType && target?.type === rule.targetType
      })
    }

    case 'block_count_min': {
      return blocks.length >= rule.count
    }

    case 'block_count_max': {
      return blocks.length <= rule.count
    }

    case 'custom': {
      // Custom validators run client-side via a registry; server always passes them
      return true
    }
  }
}

function getRuleMessage(rule: ValidationRule, passed: boolean): string {
  switch (rule.type) {
    case 'block_exists': {
      const count = rule.count ?? 1
      const label = count > 1 ? `${count} ${rule.blockType} blocks` : `a ${rule.blockType} block`
      return passed ? `Added ${label}` : `Add ${label} to the canvas`
    }

    case 'block_configured': {
      return passed
        ? `Configured ${rule.blockType} — ${rule.subBlockId}`
        : `Configure the ${rule.blockType} block's ${rule.subBlockId} field`
    }

    case 'edge_exists': {
      return passed
        ? `Connected ${rule.sourceType} → ${rule.targetType}`
        : `Connect the ${rule.sourceType} block to the ${rule.targetType} block`
    }

    case 'block_count_min': {
      return passed
        ? `At least ${rule.count} blocks added`
        : `Add at least ${rule.count} blocks to the canvas`
    }

    case 'block_count_max': {
      return passed ? `Block count within limit` : `Remove blocks — maximum is ${rule.count}`
    }

    case 'custom': {
      return passed ? 'Custom check passed' : 'Complete the custom requirement'
    }
  }
}
