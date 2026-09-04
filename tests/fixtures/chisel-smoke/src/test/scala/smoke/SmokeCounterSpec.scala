package smoke

import chisel3._
import chisel3.simulator.scalatest.ChiselSim
import org.scalatest.flatspec.AnyFlatSpec
import org.scalatest.matchers.should.Matchers

class SmokeCounterSpec extends AnyFlatSpec with Matchers with ChiselSim {
  behavior of "SmokeCounter"

  it should "elaborate, build with Verilator, and advance one cycle" in {
    simulate(new SmokeCounter) { dut =>
      dut.reset.poke(true.B)
      dut.clock.step()
      dut.reset.poke(false.B)
      dut.io.value.expect(0.U)
      dut.clock.step()
      dut.io.value.expect(1.U)
    }
  }
}
