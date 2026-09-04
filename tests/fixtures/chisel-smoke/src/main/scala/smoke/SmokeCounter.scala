package smoke

import chisel3._

class SmokeCounter extends Module {
  val io = IO(new Bundle {
    val value = Output(UInt(2.W))
  })

  val counter = RegInit(0.U(2.W))
  counter := counter + 1.U
  io.value := counter
}
