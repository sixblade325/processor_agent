ThisBuild / scalaVersion := "2.13.18"

val chiselVersion = "7.14.0"

lazy val root = (project in file("."))
  .settings(
    name := "processor-skills-chisel-smoke",
    addCompilerPlugin(
      "org.chipsalliance" % "chisel-plugin" % chiselVersion cross CrossVersion.full
    ),
    libraryDependencies ++= Seq(
      "org.chipsalliance" %% "chisel" % chiselVersion,
      "org.scalatest" %% "scalatest" % "3.2.19" % Test
    )
  )
