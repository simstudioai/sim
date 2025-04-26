let tasks = 0
let resolves = []

export function startTask() {
  tasks += 1
  return () => {
    tasks -= 1
    if (tasks === 0) {
      let prevResolves = resolves
      resolves = []
      for (let i of prevResolves) i()
    }
  }
}

export function task(cb) {
  let endTask = startTask()
  let promise = cb().finally(endTask)
  promise.t = true
  return promise
}

export function allTasks() {
  if (tasks === 0) {
    return Promise.resolve()
  } else {
    return new Promise(resolve => {
      resolves.push(resolve)
    })
  }
}

export function cleanTasks() {
  tasks = 0
}
