"""resto vision worker: counts the people seated at each table and blurs everyone in the video.

how one video frame flows through the worker:

    camera frame
      -> detector   (yolo pose: finds every person and their body keypoints)
      -> tracker    (deepsort: gives each person an id that stays the same from frame to frame)
      -> posture    (is this person seated or standing? we only count seated people)
      -> zones      (which table is this person sitting at?)
      -> occupancy  (smooths the counts so one bad frame does not flip a table)
      -> privacy    (blurs every person before the frame leaves the worker)
      -> stream     (the blurred video, for the manager and the reservation desk)
      -> reporter   (sends the table counts to the resto api)
"""
