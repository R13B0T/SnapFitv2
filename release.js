(function(root){
  /* One release manifest drives the service-worker cache and the in-app
     What's New screen. Keep the newest release first. */
  root.SNAPFIT_RELEASES = [
    {
      version:"2.2.0",
      date:"2026-09-10",
      title:"One clear next step",
      summary:"SnapFit now puts your next workout and one clear next set front and centre, while keeping your existing plan and progression exactly where they are.",
      changes:[
        "Today now previews the next day in your current block, planned time, likely muscle focus and weekly progress before you check in.",
        "The readiness check is a compact sheet, and skipping it still uses the same normal-readiness workout path as before.",
        "Focus mode shows one exercise at a time with a large next-set action; All exercises keeps the familiar full-workout view one tap away.",
        "Tap a prescribed load and rep target to see the logged-history, phase and readiness inputs behind it.",
        "Goal and workout history now live together under Progress, with honest adherence and working-load trends instead of an invented score.",
        "The main navigation is now Today, Plan, Progress and Coach. Learn remains available from the book button in the header.",
        "This update changes presentation only: your block, next workout, weights, progression, history, equipment and active session are preserved."
      ]
    },
    {
      version:"2.1.0",
      date:"2026-09-01",
      title:"A trainer after every set",
      summary:"SnapFit now coaches the set you just finished and gives you a clear target for the one that comes next.",
      changes:[
        "Post-set coaching now recommends whether to raise, hold or reduce the load — and explains why.",
        "Every recommendation includes a next-set rep target, a technique cue and rest guidance.",
        "Holding a weight is treated as productive progression when reps, control or effort are the next win.",
        "Away gyms can now pause the program for a standalone one-day session or adapt the next scheduled workout.",
        "A disrupted program week can be restarted without deleting its earlier workouts from the log.",
        "App updates now open this What's New screen once after the new version loads."
      ]
    }
  ];
})(globalThis);
